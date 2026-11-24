import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { churnWeightsOf, getDefaultClinic, paymentConfigOf } from "../lib/clinic.js";
import { buildScenarios, cardScenario, downPaymentFromPct, maxCardInstallments, minimumDownPayment, ownInstallmentScenario } from "../domain/payment.js";
import { CATEGORIES } from "../domain/types.js";
import { fallbackClassifyProcedure } from "../ai/fallback.js";
import { buildDashboard } from "../services/dashboard.js";
import { buildRiskList } from "../services/risk.js";
import { buildPricingReport } from "../services/pricing.js";
import {
  createProposal,
  createProposalSchema,
  deleteProposal,
  getProposal,
  listProposals,
  moveStage,
  moveStageSchema,
  regenerateTexts,
  updateItemDecisions,
  updateItemsSchema,
  updateProposal,
  updateProposalSchema,
} from "../services/proposals.js";
import { aiModel, classifyProcedure, generateReactivationMessage, isAiEnabled } from "../ai/AiService.js";
import { createClinicorpClient, isClinicorpConfigured, resolveSyncClinic, SyncService } from "../clinicorp/index.js";

export const api = Router();

// Pequeno wrapper p/ async handlers (Express 5 já propaga rejeições, mas mantemos explícito)
type H = (req: import("express").Request, res: import("express").Response) => Promise<unknown>;
const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));
const h = (fn: H) => (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => fn(req, res).catch(next);

api.get("/health", h(async (_req, res) => {
  const clinics = await prisma.clinic.count();
  res.json({ ok: true, seeded: clinics > 0, clinicorp: isClinicorpConfigured(), ai: isAiEnabled(), model: isAiEnabled() ? aiModel() : null });
}));

api.get("/clinic", h(async (_req, res) => {
  const clinic = await getDefaultClinic();
  const lastSync = await prisma.syncLog.findFirst({ where: { clinicId: clinic.id, status: "ok" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true, source: true } });
  res.json({
    ...clinic,
    paymentConfig: paymentConfigOf(clinic),
    ai: { enabled: isAiEnabled(), model: isAiEnabled() ? aiModel() : null },
    sync: { source: isClinicorpConfigured() ? "clinicorp" : "mock", lastSyncAt: lastSync?.finishedAt ?? null },
  });
}));

api.get("/dentists", h(async (_req, res) => {
  const clinic = await getDefaultClinic();
  res.json(await prisma.dentist.findMany({ where: { clinicId: clinic.id, active: true }, orderBy: { name: "asc" } }));
}));

// ?all=1 inclui os inativos (tela de Configurações)
api.get("/procedures", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const all = req.query.all === "1";
  res.json(await prisma.procedure.findMany({ where: { clinicId: clinic.id, ...(all ? {} : { active: true }) }, orderBy: [{ category: "asc" }, { name: "asc" }] }));
}));

const procedureSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(30).optional(),
  category: z.enum(CATEGORIES),
  basePrice: z.number().min(0),
  durationMin: z.number().int().min(5).max(600).default(60),
  description: z.string().max(500).nullable().optional(),
});

api.post("/procedures", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const input = procedureSchema.parse(req.body);
  let code = input.code || "";
  if (!code) {
    const n = await prisma.procedure.count({ where: { clinicId: clinic.id } });
    code = `OP-${String(n + 1).padStart(3, "0")}`;
  }
  // código é único por clínica: se já existir, acrescenta sufixo
  for (let i = 2; await prisma.procedure.findUnique({ where: { clinicId_code: { clinicId: clinic.id, code } } }); i++) code = `${input.code || code.replace(/-\d+$/, "")}-${i}`;
  const created = await prisma.procedure.create({
    data: { clinicId: clinic.id, code, name: input.name, category: input.category, categoryConfirmed: true, basePrice: input.basePrice, durationMin: input.durationMin, description: input.description ?? null, locallyEdited: true },
  });
  res.status(201).json(created);
}));

api.patch("/procedures/:id", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const input = procedureSchema.omit({ code: true }).partial().extend({ active: z.boolean().optional() }).parse(req.body);
  const existing = await prisma.procedure.findFirst({ where: { id: param(req.params.id), clinicId: clinic.id } });
  if (!existing) return res.status(404).json({ error: "Serviço não encontrado" });
  const touchesSynced = input.name !== undefined || input.basePrice !== undefined || input.durationMin !== undefined || input.active !== undefined;
  res.json(
    await prisma.procedure.update({
      where: { id: existing.id },
      data: { ...input, ...(input.category ? { categoryConfirmed: true } : {}), ...(touchesSynced ? { locallyEdited: true } : {}) },
    }),
  );
}));

// Sugere o tipo (clínico/funcional/estético) dos serviços ainda não confirmados,
// pelas regras de palavras-chave. Fica como sugestão: categoryConfirmed continua false.
api.post("/procedures/suggest-categories", h(async (_req, res) => {
  const clinic = await getDefaultClinic();
  const pending = await prisma.procedure.findMany({ where: { clinicId: clinic.id, categoryConfirmed: false } });
  let changed = 0;
  for (const p of pending) {
    const { category } = fallbackClassifyProcedure(p.name);
    if (category !== p.category) {
      await prisma.procedure.update({ where: { id: p.id }, data: { category } });
      changed++;
    }
  }
  res.json({ reviewed: pending.length, changed });
}));

// ── Configurações da clínica ─────────────────────────────────────────────────
const settingsSchema = z.object({
  cashDiscountPct: z.number().min(0).max(100).optional(),
  passCardFeeToPatient: z.boolean().optional(),
  minDownPaymentMode: z.enum(["pct", "fixed"]).optional(),
  minDownPaymentPct: z.number().min(0).max(100).optional(),
  minDownPaymentFixed: z.number().min(0).optional(),
  maxOwnInstallments: z.number().int().min(1).max(60).optional(),
  proposalValidityDays: z.number().int().min(1).max(365).optional(),
  priceAlertTolerancePct: z.number().min(0).max(100).optional(),
  followUpAlertDays: z.number().int().min(1).max(90).optional(),
  cardFeeTiers: z.array(z.object({ installments: z.number().int().min(1).max(24), feePct: z.number().min(0).max(99) })).min(1).optional(),
});

api.patch("/settings", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const { cardFeeTiers, ...settings } = settingsSchema.parse(req.body);
  await prisma.$transaction(async (tx) => {
    if (Object.keys(settings).length) await tx.clinicSettings.update({ where: { clinicId: clinic.id }, data: settings });
    if (cardFeeTiers) {
      const unique = [...new Map(cardFeeTiers.map((t) => [t.installments, t])).values()];
      await tx.cardFeeTier.deleteMany({ where: { clinicId: clinic.id } });
      await tx.cardFeeTier.createMany({ data: unique.map((t) => ({ clinicId: clinic.id, installments: t.installments, feePct: t.feePct })) });
    }
  });
  const updated = await getDefaultClinic();
  res.json({ settings: updated.settings, cardFeeTiers: updated.cardFeeTiers, paymentConfig: paymentConfigOf(updated) });
}));

// ── Modelos de plano ─────────────────────────────────────────────────────────
const templateInclude = { phases: { orderBy: { order: "asc" as const }, include: { items: { include: { procedure: { select: { id: true, name: true, category: true, basePrice: true, active: true } } } } } } };
const templateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phases: z
    .array(z.object({ name: z.string().trim().min(1).max(80), items: z.array(z.object({ procedureId: z.string().min(1), quantity: z.number().int().min(1).max(32).default(1) })).min(1) }))
    .min(1),
});

api.get("/plan-templates", h(async (_req, res) => {
  const clinic = await getDefaultClinic();
  res.json(await prisma.planTemplate.findMany({ where: { clinicId: clinic.id }, orderBy: { name: "asc" }, include: templateInclude }));
}));

api.post("/plan-templates", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const input = templateSchema.parse(req.body);
  const ids = [...new Set(input.phases.flatMap((p) => p.items.map((i) => i.procedureId)))];
  const found = await prisma.procedure.count({ where: { id: { in: ids }, clinicId: clinic.id } });
  if (found !== ids.length) return res.status(400).json({ error: "Modelo contém serviço que não existe nesta clínica" });
  const created = await prisma.planTemplate.create({
    data: {
      clinicId: clinic.id,
      name: input.name,
      phases: { create: input.phases.map((ph, i) => ({ order: i + 1, name: ph.name, items: { create: ph.items.map((it) => ({ procedureId: it.procedureId, quantity: it.quantity })) } })) },
    },
    include: templateInclude,
  });
  res.status(201).json(created);
}));

api.patch("/plan-templates/:id", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const { name } = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
  const r = await prisma.planTemplate.updateMany({ where: { id: param(req.params.id), clinicId: clinic.id }, data: { name } });
  if (!r.count) return res.status(404).json({ error: "Modelo não encontrado" });
  res.json({ ok: true });
}));

api.delete("/plan-templates/:id", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const r = await prisma.planTemplate.deleteMany({ where: { id: param(req.params.id), clinicId: clinic.id } });
  if (!r.count) return res.status(404).json({ error: "Modelo não encontrado" });
  res.json({ deleted: true });
}));

api.get("/patients", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const q = String(req.query.q ?? "").trim();
  const patients = await prisma.patient.findMany({
    where: { clinicId: clinic.id, ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}) },
    orderBy: { name: "asc" },
    take: 20,
    include: { appointments: { where: { status: "realizada" }, orderBy: { scheduledAt: "desc" }, take: 1, select: { scheduledAt: true } } },
  });
  res.json(patients.map(({ appointments, ...p }) => ({ ...p, lastVisitAt: appointments[0]?.scheduledAt ?? null })));
}));

api.get("/patients/:id", h(async (req, res) => {
  const p = await prisma.patient.findUnique({
    where: { id: param(req.params.id) },
    include: {
      appointments: { orderBy: { scheduledAt: "desc" }, take: 10, include: { dentist: { select: { name: true } } } },
      proposals: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, stage: true, total: true, createdAt: true } },
    },
  });
  if (!p) return res.status(404).json({ error: "Paciente não encontrado" });
  res.json(p);
}));

// ── Pagamento ────────────────────────────────────────────────────────────────
api.get("/payment/config", h(async (_req, res) => {
  const clinic = await getDefaultClinic();
  const cfg = paymentConfigOf(clinic);
  res.json({ ...cfg, maxCardInstallments: maxCardInstallments(cfg), priceAlertTolerancePct: clinic.settings!.priceAlertTolerancePct });
}));

const scenariosSchema = z.object({
  total: z.number().min(0),
  cardInstallments: z.number().int().min(1).optional(),
  ownInstallments: z.number().int().min(1).optional(),
  downPayment: z.number().min(0).optional(),
  /** Entrada em % do total (tem precedência sobre downPayment). */
  downPaymentPct: z.number().min(0).max(100).optional(),
});
api.post("/payment/scenarios", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const cfg = paymentConfigOf(clinic);
  const body = scenariosSchema.parse(req.body);
  const minDown = minimumDownPayment(body.total, cfg);
  const asked = body.downPaymentPct !== undefined ? downPaymentFromPct(body.total, body.downPaymentPct) : (body.downPayment ?? minDown);
  const down = Math.min(body.total, Math.max(minDown, asked));
  const scenarios = buildScenarios(body.total, cfg, { cardInstallments: body.cardInstallments, ownInstallments: body.ownInstallments, downPayment: down });
  // tabela completa de cartão para o seletor
  const cardTable = Array.from({ length: maxCardInstallments(cfg) }, (_, i) => cardScenario(body.total, i + 1, cfg));
  const ownTable = Array.from({ length: cfg.maxOwnInstallments }, (_, i) => ownInstallmentScenario(body.total, i + 1, down, cfg));
  res.json({ scenarios, cardTable, ownTable, minDownPayment: minDown, minDownPaymentPct: body.total > 0 ? Math.round((minDown / body.total) * 10000) / 100 : cfg.minDownPaymentPct, downPayment: down });
}));

// ── Propostas ────────────────────────────────────────────────────────────────
api.get("/proposals", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  res.json(await listProposals(clinic.id, { stage: req.query.stage as string | undefined, dentistId: req.query.dentistId as string | undefined }));
}));

api.post("/proposals", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const input = createProposalSchema.parse(req.body);
  const result = await createProposal(clinic, paymentConfigOf(clinic), input);
  res.status(201).json(result);
}));

api.get("/proposals/:id", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const p = await getProposal(param(req.params.id), paymentConfigOf(clinic));
  if (!p) return res.status(404).json({ error: "Proposta não encontrada" });
  res.json({ ...p, clinic: { name: clinic.name, city: clinic.city, state: clinic.state, phone: clinic.phone, email: clinic.email, logoUrl: clinic.logoUrl, primaryColor: clinic.primaryColor, secondaryColor: clinic.secondaryColor } });
}));

api.patch("/proposals/:id", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const input = updateProposalSchema.parse(req.body);
  res.json(await updateProposal(param(req.params.id), paymentConfigOf(clinic), input));
}));

api.patch("/proposals/:id/stage", h(async (req, res) => {
  const { stage, lostReason } = moveStageSchema.parse(req.body);
  res.json(await moveStage(param(req.params.id), stage, lostReason));
}));

// Plano de ação: decisão (aceito/recusado/pendente) e pagamento por item
api.patch("/proposals/:id/items", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const input = updateItemsSchema.parse(req.body);
  const p = await updateItemDecisions(param(req.params.id), paymentConfigOf(clinic), input);
  res.json(p);
}));

api.delete("/proposals/:id", h(async (req, res) => {
  res.json(await deleteProposal(param(req.params.id)));
}));

api.post("/proposals/:id/texts", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  res.json(await regenerateTexts(param(req.params.id), clinic.name));
}));

// ── Dashboard / risco / precificação ─────────────────────────────────────────
api.get("/dashboard", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const period = req.query.period === "quarter" ? 90 : 30;
  res.json(await buildDashboard(clinic.id, churnWeightsOf(clinic), period));
}));

api.get("/risk", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const min = Number(req.query.min ?? 0);
  const rows = await buildRiskList(clinic.id, churnWeightsOf(clinic));
  res.json({ weights: churnWeightsOf(clinic), rows: rows.filter((r) => r.score >= min) });
}));

api.post("/risk/:patientId/message", h(async (req, res) => {
  const clinic = await getDefaultClinic();
  const [row] = await buildRiskList(clinic.id, churnWeightsOf(clinic), param(req.params.patientId));
  if (!row) return res.status(404).json({ error: "Paciente não encontrado" });
  const result = await generateReactivationMessage({
    patientFirstName: row.patient.name,
    clinicName: clinic.name,
    dentistName: row.dentistName ?? undefined,
    monthsSinceLastVisit: row.monthsSinceLastVisit,
    reasons: row.reasons,
    pendingTreatments: [...new Set(row.pendingTreatments.map((t) => t.name))],
  });
  res.json(result);
}));

api.get("/pricing", h(async (_req, res) => {
  const clinic = await getDefaultClinic();
  res.json(await buildPricingReport(clinic.id));
}));

// ── IA (stub de classificação) e sync Clinicorp ──────────────────────────────
api.post("/ai/classify-procedure", h(async (req, res) => {
  const { name } = z.object({ name: z.string().min(2) }).parse(req.body);
  res.json(await classifyProcedure(name));
}));

// POST /api/sync?days=30 — importa do Clinicorp (ou do mock) os últimos N dias.
// Com credenciais reais, cada 31 dias custam ~5 requisições de uma cota de 25/hora.
api.post("/sync", h(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30) || 30));
  const fallback = await prisma.clinic.findFirst({ orderBy: { createdAt: "asc" } });
  const client = createClinicorpClient(prisma, fallback?.id ?? "");
  const clinicId = await resolveSyncClinic(prisma, client, fallback?.id ?? "");
  if (!clinicId) return res.status(400).json({ error: "Nenhuma clínica encontrada. Rode `npm run seed` ou configure o Clinicorp." });
  const svc = new SyncService(prisma, client, clinicId);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  res.json({ source: client.source, clinicId, days, result: await svc.syncAll({ from, to }) });
}));

api.get("/sync/logs", h(async (_req, res) => {
  const clinic = await getDefaultClinic();
  res.json(await prisma.syncLog.findMany({ where: { clinicId: clinic.id }, orderBy: { startedAt: "desc" }, take: 30 }));
}));
