import type { PrismaClient } from "@prisma/client";
import type { ClinicorpClient } from "./ClinicorpClient.js";
import type {
  ClinicorpAppointment,
  ClinicorpDentist,
  ClinicorpEstimate,
  ClinicorpPatient,
  ClinicorpPayment,
  ClinicorpProcedure,
  DateRange,
} from "./types.js";
import { estimateStatusFromStage } from "../domain/types.js";

/**
 * Mock: devolve o que já está no banco local (populado pelo seed) no formato
 * da API do Clinicorp. Serve para exercitar o SyncService de ponta a ponta
 * sem rede — o sync fica idempotente porque os `externalId` batem.
 *
 * Só registros com `externalId` são devolvidos: os criados localmente pelo
 * OdontoPlan (ex.: propostas novas) ainda "não existem" no Clinicorp.
 */
const fromClinicorp = { externalId: { not: null } } as const;
export class MockClinicorpClient implements ClinicorpClient {
  readonly source = "mock" as const;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly clinicId: string,
  ) {}

  async getClinic() {
    return null;
  }

  async listDentists(): Promise<ClinicorpDentist[]> {
    const rows = await this.prisma.dentist.findMany({ where: { clinicId: this.clinicId, ...fromClinicorp } });
    return rows.map((d) => ({
      id: d.externalId!,
      name: d.name,
      cro: d.cro ?? undefined,
      specialty: d.specialty ?? undefined,
      active: d.active,
    }));
  }

  async listPatients(): Promise<ClinicorpPatient[]> {
    const rows = await this.prisma.patient.findMany({ where: { clinicId: this.clinicId, ...fromClinicorp } });
    return rows.map((p) => ({
      id: p.externalId!,
      name: p.name,
      birthDate: p.birthDate?.toISOString().slice(0, 10),
      gender: (p.gender as "F" | "M" | null) ?? undefined,
      phone: p.phone ?? undefined,
      email: p.email ?? undefined,
      city: p.city ?? undefined,
      state: p.state ?? undefined,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async listProcedures(): Promise<ClinicorpProcedure[]> {
    const rows = await this.prisma.procedure.findMany({ where: { clinicId: this.clinicId, ...fromClinicorp } });
    return rows.map((p) => ({
      id: p.externalId!,
      code: p.code,
      name: p.name,
      price: p.basePrice,
      durationMin: p.durationMin,
      active: p.active,
    }));
  }

  async listAppointments(range: DateRange): Promise<ClinicorpAppointment[]> {
    const rows = await this.prisma.appointment.findMany({
      where: { clinicId: this.clinicId, ...fromClinicorp, scheduledAt: { gte: range.from, lte: range.to } },
      include: { patient: true, dentist: true, proposal: true },
    });
    return rows.map((a) => ({
      id: a.externalId!,
      patientId: a.patient.externalId ?? a.patient.id,
      dentistId: a.dentist.externalId ?? a.dentist.id,
      start: a.scheduledAt.toISOString(),
      durationMin: a.durationMin,
      type: a.type as ClinicorpAppointment["type"],
      status: a.status as ClinicorpAppointment["status"],
      estimateId: a.proposal?.externalId ?? undefined,
    }));
  }

  async listEstimates(range: DateRange): Promise<ClinicorpEstimate[]> {
    const rows = await this.prisma.proposal.findMany({
      where: { clinicId: this.clinicId, ...fromClinicorp, createdAt: { gte: range.from, lte: range.to } },
      include: { patient: true, dentist: true, items: { include: { procedure: true } } },
    });
    return rows.map((p) => ({
      id: p.externalId!,
      patientId: p.patient.externalId ?? p.patient.id,
      dentistId: p.dentist.externalId ?? p.dentist.id,
      createdAt: p.createdAt.toISOString(),
      decidedAt: p.decidedAt?.toISOString(),
      status: estimateStatusFromStage(p.stage),
      total: p.total,
      items: p.items.map((i) => ({
        procedureId: i.procedure.externalId ?? i.procedure.id,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        tooth: i.toothRegion ?? undefined,
      })),
      paymentCondition: p.paymentMethod
        ? {
            method: p.paymentMethod as "avista" | "cartao" | "boleto",
            installments: p.installments ?? 1,
            downPayment: p.downPayment ?? 0,
          }
        : undefined,
    }));
  }

  async listPayments(range: DateRange): Promise<ClinicorpPayment[]> {
    const rows = await this.prisma.payment.findMany({
      where: { clinicId: this.clinicId, ...fromClinicorp, dueDate: { gte: range.from, lte: range.to } },
      include: { proposal: true, patient: true },
    });
    return rows.map((p) => ({
      id: p.externalId!,
      estimateId: p.proposal.externalId ?? p.proposal.id,
      patientId: p.patient.externalId ?? p.patient.id,
      amount: p.amount,
      method: p.method,
      installmentNumber: p.installmentNumber,
      installmentsTotal: p.installmentsTotal,
      dueDate: p.dueDate.toISOString(),
      paidAt: p.paidAt?.toISOString(),
      status: p.status as ClinicorpPayment["status"],
    }));
  }
}
