import { z } from "zod";
import { prisma } from "../lib/db.js";
import { round2 } from "../domain/money.js";
import { buildScenarios, downPaymentFromPct, scenarioFromCondition, type PaymentConfig } from "../domain/payment.js";
import { discountFactorOf, mainDeclineReason, stageFromDecisions, summarizeActionPlan } from "../domain/actionPlan.js";
import { ITEM_DECISIONS, STAGES, type Stage } from "../domain/types.js";
import { generateProposalTexts } from "../ai/AiService.js";
import type { ClinicWithSettings } from "../lib/clinic.js";

export const createProposalSchema = z.object({
  patientId: z.string().min(1),
  dentistId: z.string().min(1),
  title: z.string().min(1).max(120),
  phases: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        items: z
          .array(
            z.object({
              procedureId: z.string().min(1),
              quantity: z.number().int().min(1).max(32),
              unitPrice: z.number().min(0),
              toothRegion: z.string().max(240).optional().nullable(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  discount: z.number().min(0).default(0),
  paymentMethod: z.enum(["avista", "cartao", "boleto"]).default("avista"),
  installments: z.number().int().min(1).default(1),
  downPayment: z.number().min(0).default(0),
  /** Entrada informada em % do total (tem precedência sobre downPayment). */
  downPaymentPct: z.number().min(0).max(100).optional(),
  observations: z.string().max(2000).optional(),
});
export type CreateProposalInput = z.infer<typeof createProposalSchema>;

export const updateProposalSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  summaryText: z.string().max(5000).nullable().optional(),
  benefitsText: z.string().max(5000).nullable().optional(),
  observations: z.string().max(5000).nullable().optional(),
  validUntil: z.string().datetime().optional(),
  phases: z.array(z.object({ id: z.string(), description: z.string().max(5000).nullable().optional(), name: z.string().min(1).max(80).optional() })).optional(),
  paymentMethod: z.enum(["avista", "cartao", "boleto"]).optional(),
  installments: z.number().int().min(1).optional(),
  downPayment: z.number().min(0).optional(),
});

/** Plano de ação: decisão e pagamento por item. */
export const updateItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        decision: z.enum(ITEM_DECISIONS).optional(),
        declineReason: z.string().max(200).nullable().optional(),
        paid: z.boolean().optional(),
      }),
    )
    .min(1),
});

export const moveStageSchema = z.object({
  stage: z.enum(STAGES),
  lostReason: z.string().max(200).optional(),
});

const fullInclude = {
  patient: true,
  dentist: true,
  phases: { orderBy: { order: "asc" as const }, include: { items: { include: { procedure: true } } } },
  stageEvents: { orderBy: { changedAt: "asc" as const } },
  payments: { orderBy: { dueDate: "asc" as const }, select: { id: true, amount: true, method: true, installmentNumber: true, installmentsTotal: true, dueDate: true, paidAt: true, status: true } },
} as const;

export async function getProposal(id: string, cfg: PaymentConfig) {
  const p = await prisma.proposal.findUnique({ where: { id }, include: fullInclude });
  if (!p) return null;
  const actionPlan = summarizeActionPlan(p.phases.flatMap((ph) => ph.items), discountFactorOf(p));
  return { ...withScenarios(p, cfg), actionPlan };
}

function withScenarios<T extends { total: number; paymentMethod: string | null; installments: number | null; downPayment: number | null }>(p: T, cfg: PaymentConfig) {
  let chosen = null;
  try {
    chosen = p.paymentMethod ? scenarioFromCondition(p.total, p.paymentMethod as "avista" | "cartao" | "boleto", p.installments ?? 1, p.downPayment ?? 0, cfg) : null;
  } catch {
    chosen = null;
  }
  // Os 3 cenários exibidos acompanham a condição escolhida (ex.: cartão em 6x, não no máximo)
  const scenarios = buildScenarios(p.total, cfg, {
    cardInstallments: p.paymentMethod === "cartao" && p.installments ? p.installments : undefined,
    ownInstallments: p.paymentMethod === "boleto" && p.installments ? p.installments : undefined,
    downPayment: p.paymentMethod === "boleto" && p.downPayment ? p.downPayment : undefined,
  });
  return { ...p, scenarios, chosenScenario: chosen };
}

export async function listProposals(clinicId: string, filters: { stage?: string; dentistId?: string }) {
  const rows = await prisma.proposal.findMany({
    where: { clinicId, ...(filters.stage ? { stage: filters.stage } : {}), ...(filters.dentistId ? { dentistId: filters.dentistId } : {}) },
    orderBy: [{ stageChangedAt: "desc" }],
    select: {
      id: true,
      externalId: true,
      title: true,
      stage: true,
      stageChangedAt: true,
      createdAt: true,
      presentedAt: true,
      decidedAt: true,
      subtotal: true,
      total: true,
      paymentMethod: true,
      installments: true,
      lostReason: true,
      patient: { select: { id: true, name: true } },
      dentist: { select: { id: true, name: true, color: true } },
      items: { select: { total: true, decision: true, paidAt: true, declineReason: true } },
    },
  });
  return rows.map(({ items, subtotal, ...p }) => ({
    ...p,
    actionPlan: summarizeActionPlan(items, discountFactorOf({ subtotal, total: p.total })),
    declineReason: mainDeclineReason(items) ?? p.lostReason,
  }));
}

export async function createProposal(clinic: ClinicWithSettings, cfg: PaymentConfig, input: CreateProposalInput) {
  const procedureIds = [...new Set(input.phases.flatMap((p) => p.items.map((i) => i.procedureId)))];
  const procedures = await prisma.procedure.findMany({ where: { id: { in: procedureIds }, clinicId: clinic.id } });
  const procById = new Map(procedures.map((p) => [p.id, p]));
  for (const id of procedureIds) if (!procById.has(id)) throw new Error(`Procedimento ${id} não encontrado`);

  const phases = input.phases.map((ph, i) => ({
    order: i + 1,
    name: ph.name,
    items: ph.items.map((it) => {
      const proc = procById.get(it.procedureId)!;
      return {
        procedureId: proc.id,
        description: proc.name,
        toothRegion: it.toothRegion ?? null,
        quantity: it.quantity,
        referencePrice: proc.basePrice,
        unitPrice: round2(it.unitPrice),
        total: round2(it.unitPrice * it.quantity),
        _procedure: proc,
      };
    }),
  }));
  const allItems = phases.flatMap((p) => p.items);
  const referenceTotal = round2(allItems.reduce((s, i) => s + i.referencePrice * i.quantity, 0));
  const subtotal = round2(allItems.reduce((s, i) => s + i.total, 0));
  const discount = round2(Math.min(input.discount, subtotal));
  const total = round2(subtotal - discount);

  // Condição de pagamento validada pelo domínio (lança erro se inválida)
  const downPayment = input.downPaymentPct !== undefined ? downPaymentFromPct(total, input.downPaymentPct) : input.downPayment;
  const scenario = scenarioFromCondition(total, input.paymentMethod, input.installments, downPayment, cfg);

  const [patient, dentist] = await Promise.all([
    prisma.patient.findUniqueOrThrow({ where: { id: input.patientId } }),
    prisma.dentist.findUniqueOrThrow({ where: { id: input.dentistId } }),
  ]);

  // Textos (rascunho IA ou fallback) — nunca contêm números calculados pela IA.
  const { texts, source } = await generateProposalTexts({
    patientFirstName: patient.name,
    dentistName: dentist.name,
    clinicName: clinic.name,
    total,
    phases: phases.map((p) => ({
      name: p.name,
      items: p.items.map((i) => ({ name: i.description, quantity: i.quantity, category: i._procedure.category, description: i._procedure.description })),
    })),
  });

  const now = new Date();
  const validUntil = new Date(now.getTime() + clinic.settings!.proposalValidityDays * 86_400_000);
  const created = await prisma.proposal.create({
    data: {
      clinicId: clinic.id,
      patientId: patient.id,
      dentistId: dentist.id,
      title: input.title,
      stage: "planejamento",
      stageChangedAt: now,
      validUntil,
      referenceTotal,
      subtotal,
      discount,
      total,
      paymentMethod: input.paymentMethod,
      installments: input.installments,
      downPayment: input.paymentMethod === "boleto" ? round2(downPayment) : 0,
      installmentValue: scenario.installmentValue,
      finalAmount: scenario.total,
      summaryText: texts.summary,
      benefitsText: texts.benefits,
      observations: input.observations ?? null,
      stageEvents: { create: { toStage: "planejamento", changedAt: now } },
    },
  });
  for (const ph of phases) {
    await prisma.proposalPhase.create({
      data: {
        proposalId: created.id,
        order: ph.order,
        name: ph.name,
        description: texts.phases[ph.order - 1] ?? null,
        items: {
          create: ph.items.map(({ _procedure, ...it }) => ({ ...it, proposalId: created.id })),
        },
      },
    });
  }
  return { id: created.id, textsSource: source };
}

export async function regenerateTexts(id: string, clinicName: string) {
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id }, include: fullInclude });
  const { texts, source } = await generateProposalTexts({
    patientFirstName: p.patient.name,
    dentistName: p.dentist.name,
    clinicName,
    total: p.total,
    phases: p.phases.map((ph) => ({
      name: ph.name,
      items: ph.items.map((i) => ({ name: i.description, quantity: i.quantity, category: i.procedure.category, description: i.procedure.description })),
    })),
  });
  return { texts: { ...texts, phases: p.phases.map((ph, i) => ({ id: ph.id, description: texts.phases[i] })) }, source };
}

export async function updateProposal(id: string, cfg: PaymentConfig, input: z.infer<typeof updateProposalSchema>) {
  const existing = await prisma.proposal.findUniqueOrThrow({ where: { id } });
  const data: Record<string, unknown> = {};
  for (const k of ["title", "summaryText", "benefitsText", "observations"] as const) if (input[k] !== undefined) data[k] = input[k];
  if (input.validUntil) data.validUntil = new Date(input.validUntil);
  if (input.paymentMethod || input.installments !== undefined || input.downPayment !== undefined) {
    const method = (input.paymentMethod ?? existing.paymentMethod ?? "avista") as "avista" | "cartao" | "boleto";
    const installments = input.installments ?? existing.installments ?? 1;
    const down = method === "boleto" ? (input.downPayment ?? existing.downPayment ?? 0) : 0;
    const sc = scenarioFromCondition(existing.total, method, installments, down, cfg);
    Object.assign(data, { paymentMethod: method, installments, downPayment: down, installmentValue: sc.installmentValue, finalAmount: sc.total });
  }
  await prisma.proposal.update({ where: { id }, data });
  if (input.phases) {
    for (const ph of input.phases) {
      const d: Record<string, unknown> = {};
      if (ph.description !== undefined) d.description = ph.description;
      if (ph.name !== undefined) d.name = ph.name;
      if (Object.keys(d).length) await prisma.proposalPhase.update({ where: { id: ph.id }, data: d });
    }
  }
  return getProposal(id, cfg);
}

const isClosed = (stage: string) => stage === "aceita" || stage === "perdida";

/**
 * Move a proposta no Kanban. Com `syncItems` (padrão, movimento feito pelo
 * usuário) as decisões dos itens acompanham:
 *  - para "aceita"/"perdida": os itens pendentes recebem essa decisão; se não
 *    havia pendente (cartão já decidido), vale para todos os itens não pagos;
 *  - para uma etapa aberta: os itens não pagos voltam a pendente.
 * Se depois disso ainda houver item aceito, a etapa final é "aceita" mesmo que
 * o destino fosse "perdida" (o Kanban mostra a parte recusada em "Perdida").
 */
export async function moveStage(id: string, requested: Stage, lostReason?: string, opts: { syncItems?: boolean } = {}) {
  const syncItems = opts.syncItems ?? true;
  const existing = await prisma.proposal.findUniqueOrThrow({ where: { id }, include: { items: { select: { id: true, decision: true, paidAt: true } } } });
  const now = new Date();
  let stage: Stage = requested;

  if (syncItems) {
    if (isClosed(requested)) {
      const decision = requested === "aceita" ? "aceito" : "recusado";
      const pending = existing.items.filter((i) => i.decision === "pendente");
      const targets = pending.length ? pending : existing.items.filter((i) => i.decision !== decision && !i.paidAt);
      if (targets.length) {
        await prisma.proposalItem.updateMany({
          where: { id: { in: targets.map((i) => i.id) } },
          data: { decision, decidedAt: now, declineReason: decision === "recusado" ? (lostReason ?? "Não informado") : null },
        });
      }
    } else {
      await prisma.proposalItem.updateMany({ where: { proposalId: id, paidAt: null, decision: { not: "pendente" } }, data: { decision: "pendente", decidedAt: null, declineReason: null } });
    }
    const after = await prisma.proposalItem.findMany({ where: { proposalId: id }, select: { decision: true } });
    if (isClosed(requested)) stage = stageFromDecisions(after) ?? requested;
  }

  if (existing.stage === stage) return prisma.proposal.findUniqueOrThrow({ where: { id } });
  const data: Record<string, unknown> = { stage, stageChangedAt: now };
  if ((stage === "apresentada" || stage === "negociacao") && !existing.presentedAt) data.presentedAt = now;
  if (isClosed(stage)) {
    data.decidedAt = now;
    if (!existing.presentedAt) data.presentedAt = now;
    data.lostReason = stage === "perdida" ? (lostReason ?? "Não informado") : null;
    if (stage === "aceita") {
      // fases passam a "em andamento" a partir da primeira pendente
      const first = await prisma.proposalPhase.findFirst({ where: { proposalId: id, status: "pendente" }, orderBy: { order: "asc" } });
      if (first) await prisma.proposalPhase.update({ where: { id: first.id }, data: { status: "em_andamento" } });
    }
  } else {
    data.decidedAt = null;
    data.lostReason = null;
  }
  return prisma.proposal.update({
    where: { id },
    data: { ...data, stageEvents: { create: { fromStage: existing.stage, toStage: stage, changedAt: now } } },
  });
}

/**
 * Plano de ação: grava decisão (aceito/recusado/pendente), motivo de recusa e
 * confirmação de pagamento por item. Quando não sobra item pendente, a etapa
 * do Kanban acompanha: "aceita" se algo foi aceito, senão "perdida".
 */
export async function updateItemDecisions(id: string, cfg: PaymentConfig, input: z.infer<typeof updateItemsSchema>) {
  const proposal = await prisma.proposal.findUnique({ where: { id }, include: { items: true } });
  if (!proposal) throw new Error("Proposta não encontrada");
  const byId = new Map(proposal.items.map((i) => [i.id, i]));
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const patch of input.items) {
      const current = byId.get(patch.id);
      if (!current) throw new Error(`Item ${patch.id} não encontrado nesta proposta`);
      const decision = patch.decision ?? (patch.paid ? "aceito" : current.decision);
      const data: Record<string, unknown> = {};
      if (decision !== current.decision) {
        data.decision = decision;
        data.decidedAt = decision === "pendente" ? null : now;
      }
      if (decision === "recusado") {
        if (patch.declineReason !== undefined) data.declineReason = patch.declineReason?.trim() || null;
      } else if (current.declineReason) {
        data.declineReason = null;
      }
      // Pagamento só existe para item aceito.
      if (decision !== "aceito") {
        if (current.paidAt) data.paidAt = null;
      } else if (patch.paid !== undefined) {
        data.paidAt = patch.paid ? (current.paidAt ?? now) : null;
      }
      if (Object.keys(data).length) await tx.proposalItem.update({ where: { id: current.id }, data });
    }
  });

  const items = await prisma.proposalItem.findMany({ where: { proposalId: id }, select: { decision: true, declineReason: true } });
  const target = stageFromDecisions(items);
  if (target && target !== proposal.stage) {
    await moveStage(id, target, target === "perdida" ? (mainDeclineReason(items) ?? undefined) : undefined, { syncItems: false });
  } else if (!target && (proposal.stage === "aceita" || proposal.stage === "perdida")) {
    // Um item voltou a ficar pendente numa proposta já fechada: reabre a negociação.
    await moveStage(id, "negociacao", undefined, { syncItems: false });
  }
  return getProposal(id, cfg);
}

/**
 * Exclui a proposta e tudo que depende dela (fases, itens, eventos, pagamentos
 * importados); consultas vinculadas ficam sem proposta. Se veio do Clinicorp,
 * grava uma lápide para o sync não trazê-la de volta.
 */
export async function deleteProposal(id: string) {
  const p = await prisma.proposal.findUnique({ where: { id }, select: { id: true, clinicId: true, externalId: true, title: true } });
  if (!p) throw new Error("Proposta não encontrada");
  await prisma.$transaction(async (tx) => {
    if (p.externalId) {
      await tx.proposalTombstone.upsert({
        where: { clinicId_externalId: { clinicId: p.clinicId, externalId: p.externalId } },
        create: { clinicId: p.clinicId, externalId: p.externalId, title: p.title },
        update: { title: p.title, deletedAt: new Date() },
      });
    }
    await tx.proposal.delete({ where: { id } });
  });
  return { deleted: true, externalId: p.externalId };
}
