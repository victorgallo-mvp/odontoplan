import { prisma } from "../lib/db.js";
import { round2 } from "../domain/money.js";
import { buildRiskList } from "./risk.js";
import type { ChurnWeights } from "../domain/churn.js";

const DAY = 86_400_000;

export async function buildDashboard(clinicId: string, weights: ChurnWeights, periodDays: number) {
  const now = new Date();
  const since = new Date(now.getTime() - periodDays * DAY);
  const prevSince = new Date(since.getTime() - periodDays * DAY);

  const [created, prevCreated, decided, prevDecided, acceptedItems, risk, stages, byMonth, stale, dentists, open] = await Promise.all([
    prisma.proposal.findMany({ where: { clinicId, createdAt: { gte: since } }, select: { total: true, dentistId: true } }),
    prisma.proposal.findMany({ where: { clinicId, createdAt: { gte: prevSince, lt: since } }, select: { total: true } }),
    prisma.proposal.findMany({ where: { clinicId, decidedAt: { gte: since } }, select: { stage: true, dentistId: true } }),
    prisma.proposal.findMany({ where: { clinicId, decidedAt: { gte: prevSince, lt: since } }, select: { stage: true } }),
    // Itens aceitos no período (aceite parcial conta mesmo com a proposta ainda aberta)
    prisma.proposalItem.findMany({
      where: { decision: "aceito", decidedAt: { gte: since }, proposal: { clinicId } },
      select: { total: true, paidAt: true, proposalId: true, procedure: { select: { category: true } }, proposal: { select: { dentistId: true, subtotal: true, total: true } } },
    }),
    buildRiskList(clinicId, weights),
    prisma.proposal.groupBy({ by: ["stage"], where: { clinicId }, _count: { _all: true }, _sum: { total: true } }),
    prisma.proposal.findMany({ where: { clinicId, createdAt: { gte: new Date(now.getTime() - 180 * DAY) } }, select: { createdAt: true, stage: true, total: true } }),
    prisma.proposal.findMany({
      where: { clinicId, stage: "apresentada", stageChangedAt: { lt: new Date(now.getTime() - 7 * DAY) } },
      include: { patient: { select: { name: true } }, dentist: { select: { name: true } } },
      orderBy: { stageChangedAt: "asc" },
      take: 6,
    }),
    prisma.dentist.findMany({ where: { clinicId }, select: { id: true, name: true, color: true, active: true } }),
    prisma.proposal.findMany({ where: { clinicId, stage: { notIn: ["aceita", "perdida"] } }, select: { dentistId: true, total: true } }),
  ]);

  // Valor do item já com o desconto adicional da proposta distribuído
  const net = (it: (typeof acceptedItems)[number]) => it.total * (it.proposal.subtotal > 0 ? it.proposal.total / it.proposal.subtotal : 1);

  const rate = (list: { stage: string }[]) => {
    const d = list.filter((p) => p.stage === "aceita" || p.stage === "perdida");
    return d.length ? d.filter((p) => p.stage === "aceita").length / d.length : null;
  };
  const avg = (list: { total: number }[]) => (list.length ? list.reduce((s, p) => s + p.total, 0) / list.length : 0);

  const revenueByCategory: Record<string, number> = { clinico: 0, funcional: 0, estetico: 0 };
  for (const it of acceptedItems) revenueByCategory[it.procedure.category] = round2((revenueByCategory[it.procedure.category] ?? 0) + net(it));

  // Desempenho por dentista no período
  const byDentist = dentists
    .map((d) => {
      const mine = acceptedItems.filter((i) => i.proposal.dentistId === d.id);
      const closed = decided.filter((p) => p.dentistId === d.id && (p.stage === "aceita" || p.stage === "perdida"));
      const acceptedProposals = new Set(mine.map((i) => i.proposalId)).size;
      const acceptedValue = round2(mine.reduce((s, i) => s + net(i), 0));
      const mineCreated = created.filter((p) => p.dentistId === d.id);
      return {
        dentistId: d.id,
        name: d.name,
        color: d.color,
        proposalsCreated: mineCreated.length,
        createdValue: round2(mineCreated.reduce((s, p) => s + p.total, 0)),
        acceptedProposals,
        acceptedValue,
        paidValue: round2(mine.filter((i) => i.paidAt).reduce((s, i) => s + net(i), 0)),
        avgTicket: acceptedProposals ? round2(acceptedValue / acceptedProposals) : 0,
        acceptanceRate: closed.length ? closed.filter((p) => p.stage === "aceita").length / closed.length : null,
        openValue: round2(open.filter((p) => p.dentistId === d.id).reduce((s, p) => s + p.total, 0)),
        openCount: open.filter((p) => p.dentistId === d.id).length,
        active: d.active,
      };
    })
    .filter((d) => d.active || d.proposalsCreated > 0 || d.acceptedValue > 0 || d.openCount > 0)
    .sort((a, b) => b.acceptedValue - a.acceptedValue || b.createdValue - a.createdValue);

  // Série mensal (últimos 6 meses): criadas e aceitas
  const months: { key: string; label: string; created: number; accepted: number; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), created: 0, accepted: 0, value: 0 });
  }
  for (const p of byMonth) {
    const key = `${p.createdAt.getFullYear()}-${p.createdAt.getMonth()}`;
    const m = months.find((x) => x.key === key);
    if (!m) continue;
    m.created++;
    if (p.stage === "aceita") {
      m.accepted++;
      m.value = round2(m.value + p.total);
    }
  }

  const atRisk = risk.filter((r) => r.score >= 50);

  return {
    periodDays,
    kpis: {
      proposalsCreated: { value: created.length, previous: prevCreated.length },
      acceptanceRate: { value: rate(decided), previous: rate(prevDecided), decided: decided.filter((p) => p.stage !== "pendente").length },
      avgTicket: { value: round2(avg(created)), previous: round2(avg(prevCreated)) },
      acceptedValue: round2(acceptedItems.reduce((s, i) => s + net(i), 0)),
      patientsAtRisk: { value: atRisk.length, stalledValue: round2(atRisk.reduce((s, r) => s + r.stalledValue, 0)) },
    },
    revenueByCategory,
    dentists: byDentist,
    funnel: stages.map((s) => ({ stage: s.stage, count: s._count._all, value: round2(s._sum.total ?? 0) })),
    months,
    followUps: stale.map((p) => ({
      id: p.id,
      patient: p.patient.name,
      dentist: p.dentist.name,
      total: p.total,
      days: Math.floor((now.getTime() - p.stageChangedAt.getTime()) / DAY),
    })),
  };
}
