import type { PrismaClient } from "@prisma/client";
import type { ClinicorpClient } from "./ClinicorpClient.js";
import type { DateRange } from "./types.js";
import { round2 } from "../domain/money.js";

type Resource = "dentists" | "procedures" | "patients" | "appointments" | "estimates" | "payments";

/**
 * Importa do ClinicorpClient para as tabelas locais, com upsert por
 * (clinic_id, external_id). Pensado para rodar como batch diário.
 *
 * No MVP o client é o mock (que lê do próprio banco), então o sync é
 * idempotente/trivial — mas o caminho de código é o mesmo que a integração
 * real vai usar.
 *
 * Regras de proteção do que é "nosso":
 *  - Propostas já existentes NÃO são sobrescritas (fases, textos e stage do
 *    Kanban são enriquecimento local). Só o status aprovado/recusado vindo do
 *    Clinicorp promove a proposta para aceita/perdida se ela ainda estiver aberta.
 *  - Procedimentos novos entram com categoria "clinico" e
 *    category_confirmed = false, para a IA sugerir e o dentista confirmar.
 */
export class SyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: ClinicorpClient,
    private readonly clinicId: string,
  ) {}

  async syncAll(range: DateRange) {
    const results: Record<Resource, number> = {
      dentists: await this.run("dentists", () => this.syncDentists(range)),
      procedures: await this.run("procedures", () => this.syncProcedures(range)),
      patients: await this.run("patients", () => this.syncPatients(range)),
      appointments: await this.run("appointments", () => this.syncAppointments(range)),
      estimates: await this.run("estimates", () => this.syncEstimates(range)),
      payments: await this.run("payments", () => this.syncPayments(range)),
    };
    return results;
  }

  private async run(resource: Resource, fn: () => Promise<number>): Promise<number> {
    const log = await this.prisma.syncLog.create({
      data: { clinicId: this.clinicId, resource, source: this.client.source },
    });
    try {
      const n = await fn();
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: { status: "ok", recordsUpserted: n, finishedAt: new Date() },
      });
      return n;
    } catch (err) {
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: { status: "error", error: String(err), finishedAt: new Date() },
      });
      throw err;
    }
  }

  async syncDentists(range: DateRange) {
    const rows = await this.client.listDentists(range);
    for (const d of rows) {
      await this.prisma.dentist.upsert({
        where: { clinicId_externalId: { clinicId: this.clinicId, externalId: d.id } },
        create: { clinicId: this.clinicId, externalId: d.id, name: d.name, cro: d.cro, specialty: d.specialty, active: d.active ?? true },
        update: { name: d.name, cro: d.cro, specialty: d.specialty, active: d.active ?? true },
      });
    }
    return rows.length;
  }

  async syncProcedures(range: DateRange) {
    const rows = await this.client.listProcedures(range);
    // Serviços editados em Configurações (nome, valor, ativo) não são sobrescritos pelo sync.
    const locked = new Set(
      (await this.prisma.procedure.findMany({ where: { clinicId: this.clinicId, locallyEdited: true }, select: { externalId: true } })).map((p) => p.externalId),
    );
    for (const p of rows) {
      if (locked.has(p.id)) continue;
      await this.prisma.procedure.upsert({
        where: { clinicId_externalId: { clinicId: this.clinicId, externalId: p.id } },
        create: {
          clinicId: this.clinicId,
          externalId: p.id,
          code: p.code,
          name: p.name,
          basePrice: p.price,
          durationMin: p.durationMin ?? 60,
          active: p.active ?? true,
          category: "clinico", // placeholder até a IA sugerir e o dentista confirmar
          categoryConfirmed: false,
        },
        // Preço 0 = Clinicorp não informou (catálogo sem preço); não sobrescreve o que já temos.
        update: { name: p.name, basePrice: p.price > 0 ? p.price : undefined, durationMin: p.durationMin ?? 60, active: p.active ?? true },
      });
    }
    return rows.length;
  }

  async syncPatients(range: DateRange) {
    const rows = await this.client.listPatients(range);
    for (const p of rows) {
      const data = {
        name: p.name,
        birthDate: p.birthDate ? new Date(p.birthDate) : null,
        gender: p.gender ?? null,
        phone: p.phone ?? null,
        email: p.email ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
      };
      await this.prisma.patient.upsert({
        where: { clinicId_externalId: { clinicId: this.clinicId, externalId: p.id } },
        create: { clinicId: this.clinicId, externalId: p.id, createdAt: new Date(p.createdAt), ...data },
        update: data,
      });
    }
    return rows.length;
  }

  private async idMaps() {
    const [patients, dentists, procedures, proposals] = await Promise.all([
      this.prisma.patient.findMany({ where: { clinicId: this.clinicId }, select: { id: true, externalId: true } }),
      this.prisma.dentist.findMany({ where: { clinicId: this.clinicId }, select: { id: true, externalId: true } }),
      this.prisma.procedure.findMany({ where: { clinicId: this.clinicId }, select: { id: true, externalId: true } }),
      this.prisma.proposal.findMany({ where: { clinicId: this.clinicId }, select: { id: true, externalId: true } }),
    ]);
    const toMap = (rows: { id: string; externalId: string | null }[]) =>
      new Map(rows.filter((r) => r.externalId).map((r) => [r.externalId!, r.id]));
    return { patients: toMap(patients), dentists: toMap(dentists), procedures: toMap(procedures), proposals: toMap(proposals) };
  }

  async syncAppointments(range: DateRange) {
    const rows = await this.client.listAppointments(range);
    const maps = await this.idMaps();
    let n = 0;
    for (const a of rows) {
      const patientId = maps.patients.get(a.patientId);
      const dentistId = maps.dentists.get(a.dentistId);
      if (!patientId || !dentistId) continue;
      const proposalId = a.estimateId ? (maps.proposals.get(a.estimateId) ?? null) : null;
      await this.prisma.appointment.upsert({
        where: { clinicId_externalId: { clinicId: this.clinicId, externalId: a.id } },
        create: {
          clinicId: this.clinicId,
          externalId: a.id,
          patientId,
          dentistId,
          proposalId,
          scheduledAt: new Date(a.start),
          durationMin: a.durationMin,
          type: a.type,
          status: a.status,
        },
        update: { scheduledAt: new Date(a.start), durationMin: a.durationMin, type: a.type, status: a.status, proposalId },
      });
      n++;
    }
    return n;
  }

  async syncEstimates(range: DateRange) {
    const rows = await this.client.listEstimates(range);
    const maps = await this.idMaps();
    const tombstones = new Set(
      (await this.prisma.proposalTombstone.findMany({ where: { clinicId: this.clinicId }, select: { externalId: true } })).map((t) => t.externalId),
    );
    let n = 0;
    for (const e of rows) {
      if (tombstones.has(e.id)) continue; // excluído no OdontoPlan: não volta
      const existingId = maps.proposals.get(e.id);
      if (existingId) {
        // Só promove status final vindo do Clinicorp; nunca mexe em fases/textos.
        if (e.status !== "pendente") {
          const existing = await this.prisma.proposal.findUnique({ where: { id: existingId } });
          if (existing && existing.stage !== "aceita" && existing.stage !== "perdida") {
            const stage = e.status === "aprovado" ? "aceita" : "perdida";
            const when = e.decidedAt ? new Date(e.decidedAt) : new Date();
            await this.prisma.proposal.update({
              where: { id: existingId },
              data: {
                stage,
                stageChangedAt: when,
                decidedAt: when,
                stageEvents: { create: { fromStage: existing.stage, toStage: stage, changedAt: when, note: "Sincronizado do Clinicorp" } },
              },
            });
            await this.prisma.proposalItem.updateMany({
              where: { proposalId: existingId, decision: "pendente" },
              data: stage === "aceita" ? { decision: "aceito", decidedAt: when } : { decision: "recusado", decidedAt: when },
            });
            n++;
          }
        }
        continue;
      }
      const patientId = maps.patients.get(e.patientId);
      const dentistId = maps.dentists.get(e.dentistId);
      if (!patientId || !dentistId) continue;
      const items = e.items
        .map((i) => ({ ...i, procedureId: maps.procedures.get(i.procedureId) }))
        .filter((i): i is typeof i & { procedureId: string } => !!i.procedureId);
      if (items.length === 0) continue;
      const procs = await this.prisma.procedure.findMany({ where: { id: { in: items.map((i) => i.procedureId) } } });
      const refOf = new Map(procs.map((p) => [p.id, p.basePrice]));
      const referenceTotal = round2(items.reduce((s, i) => s + (refOf.get(i.procedureId) ?? i.unitPrice) * i.quantity, 0));
      const subtotal = round2(items.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
      const stage = e.status === "aprovado" ? "aceita" : e.status === "recusado" ? "perdida" : "apresentada";
      const createdAt = new Date(e.createdAt);
      const decidedAt = e.decidedAt ? new Date(e.decidedAt) : null;
      const created = await this.prisma.proposal.create({
        data: {
          clinicId: this.clinicId,
          externalId: e.id,
          patientId,
          dentistId,
          title: "Orçamento importado do Clinicorp",
          stage,
          stageChangedAt: decidedAt ?? createdAt,
          createdAt,
          decidedAt,
          validUntil: new Date(createdAt.getTime() + 30 * 86400000),
          referenceTotal,
          subtotal,
          discount: round2(subtotal - e.total),
          total: e.total,
          paymentMethod: e.paymentCondition?.method,
          installments: e.paymentCondition?.installments,
          downPayment: e.paymentCondition?.downPayment,
          stageEvents: { create: { toStage: stage, changedAt: decidedAt ?? createdAt, note: "Importado do Clinicorp" } },
        },
      });
      // Clinicorp não tem fases: tudo entra numa fase única, que o dentista reorganiza depois.
      await this.prisma.proposalPhase.create({
        data: {
          proposalId: created.id,
          order: 1,
          name: "Plano importado",
          status: stage === "aceita" ? "em_andamento" : "pendente",
          items: {
            create: items.map((i) => ({
              proposalId: created.id,
              procedureId: i.procedureId,
              description: i.description,
              toothRegion: i.tooth,
              quantity: i.quantity,
              referencePrice: refOf.get(i.procedureId) ?? i.unitPrice,
              unitPrice: i.unitPrice,
              total: round2(i.unitPrice * i.quantity),
              decision: stage === "aceita" ? "aceito" : stage === "perdida" ? "recusado" : "pendente",
              decidedAt: stage === "apresentada" ? null : decidedAt,
            })),
          },
        },
      });
      n++;
    }
    return n;
  }

  async syncPayments(range: DateRange) {
    const rows = await this.client.listPayments(range);
    const maps = await this.idMaps();
    let n = 0;
    for (const p of rows) {
      const proposalId = maps.proposals.get(p.estimateId);
      const patientId = maps.patients.get(p.patientId);
      if (!proposalId || !patientId) continue;
      const data = {
        amount: p.amount,
        method: p.method,
        installmentNumber: p.installmentNumber,
        installmentsTotal: p.installmentsTotal,
        dueDate: new Date(p.dueDate),
        paidAt: p.paidAt ? new Date(p.paidAt) : null,
        status: p.status,
      };
      await this.prisma.payment.upsert({
        where: { clinicId_externalId: { clinicId: this.clinicId, externalId: p.id } },
        create: { clinicId: this.clinicId, externalId: p.id, proposalId, patientId, ...data },
        update: data,
      });
      n++;
    }
    return n;
  }
}
