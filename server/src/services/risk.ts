import { prisma } from "../lib/db.js";
import { computeChurnScore, monthsBetween, type ChurnWeights, type PatientRiskInput } from "../domain/churn.js";

export interface RiskRow {
  patient: { id: string; name: string; phone: string | null; city: string | null; age: number | null };
  score: number;
  reasons: string[];
  stalledValue: number;
  breakdown: { monthsAway: number; pendingTreatment: number; recallOverdue: number; noShow: number };
  lastVisitAt: string | null;
  monthsSinceLastVisit: number | null;
  pendingTreatments: { name: string; value: number; phaseName: string; proposalId: string }[];
  openProposals: { id: string; title: string; total: number; stage: string }[];
  dentistName: string | null;
}

function ageOf(birth: Date | null): number | null {
  if (!birth) return null;
  const diff = Date.now() - birth.getTime();
  return Math.floor(diff / (365.25 * 86_400_000));
}

/** Monta a lista de risco para toda a clínica (ou um paciente só). */
export async function buildRiskList(clinicId: string, weights: ChurnWeights, patientId?: string): Promise<RiskRow[]> {
  const now = new Date();
  const patients = await prisma.patient.findMany({
    where: { clinicId, ...(patientId ? { id: patientId } : {}) },
    include: {
      appointments: {
        where: { status: { in: ["realizada", "faltou"] }, scheduledAt: { lte: now } },
        orderBy: { scheduledAt: "desc" },
        include: { dentist: { select: { name: true } } },
      },
      proposals: {
        where: { stage: { notIn: ["perdida"] } },
        include: { phases: { include: { items: true }, orderBy: { order: "asc" } } },
      },
    },
  });

  const rows: RiskRow[] = patients.map((p) => {
    const done = p.appointments.filter((a) => a.status === "realizada");
    const lastVisit = done[0] ?? null;
    const lastRecall = done.find((a) => a.type === "revisao") ?? null;
    const noShow = p.appointments.filter((a) => a.status === "faltou").length;

    const pendingTreatments: RiskRow["pendingTreatments"] = [];
    const openProposals: RiskRow["openProposals"] = [];
    for (const pr of p.proposals) {
      if (pr.stage === "aceita") {
        for (const ph of pr.phases) {
          if (ph.status === "concluida") continue;
          for (const it of ph.items) pendingTreatments.push({ name: it.description, value: it.total, phaseName: ph.name, proposalId: pr.id });
        }
      } else {
        openProposals.push({ id: pr.id, title: pr.title, total: pr.total, stage: pr.stage });
      }
    }

    const input: PatientRiskInput = {
      monthsSinceLastVisit: lastVisit ? monthsBetween(lastVisit.scheduledAt, now) : null,
      monthsSinceLastRecall: lastRecall ? monthsBetween(lastRecall.scheduledAt, now) : lastVisit ? monthsBetween(lastVisit.scheduledAt, now) : null,
      pendingTreatments,
      openProposalsValue: openProposals.reduce((s, o) => s + o.total, 0),
      noShowCount: noShow,
      appointmentCount: p.appointments.length,
    };
    const r = computeChurnScore(input, weights);
    return {
      patient: { id: p.id, name: p.name, phone: p.phone, city: p.city, age: ageOf(p.birthDate) },
      score: r.score,
      reasons: r.reasons,
      stalledValue: r.stalledValue,
      breakdown: r.breakdown,
      lastVisitAt: lastVisit?.scheduledAt.toISOString() ?? null,
      monthsSinceLastVisit: input.monthsSinceLastVisit === null ? null : Math.round(input.monthsSinceLastVisit * 10) / 10,
      pendingTreatments,
      openProposals,
      dentistName: lastVisit?.dentist.name ?? null,
    };
  });

  return rows.sort((a, b) => b.score - a.score || b.stalledValue - a.stalledValue);
}
