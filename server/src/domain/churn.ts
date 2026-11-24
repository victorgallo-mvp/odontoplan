// ─────────────────────────────────────────────────────────────────────────────
// Score de risco de churn/recall — regras determinísticas, pesos em config.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChurnWeights {
  monthsAway: number; // peso máx. do tempo sem consulta
  pendingTreatment: number; // peso de tratamento aprovado não concluído
  recallOverdue: number; // peso de revisão semestral vencida
  noShow: number; // peso do histórico de faltas
  monthsForMaxScore: number; // a partir de quantos meses o fator tempo satura
  recallIntervalMonths: number; // intervalo da revisão (ex.: 6)
}

export const DEFAULT_CHURN_WEIGHTS: ChurnWeights = {
  monthsAway: 45,
  pendingTreatment: 25,
  recallOverdue: 15,
  noShow: 15,
  monthsForMaxScore: 12,
  recallIntervalMonths: 6,
};

export interface PatientRiskInput {
  /** Meses desde a última consulta realizada (null = nunca veio). */
  monthsSinceLastVisit: number | null;
  /** Meses desde a última revisão/manutenção realizada (null = nunca fez). */
  monthsSinceLastRecall: number | null;
  /** Procedimentos aprovados e ainda não realizados (fases pendentes). */
  pendingTreatments: { name: string; value: number; phaseName: string }[];
  /** Propostas ainda em aberto (não aceitas nem perdidas). */
  openProposalsValue: number;
  noShowCount: number;
  appointmentCount: number; // consultas com desfecho (realizada + faltou)
}

export interface PatientRiskResult {
  score: number; // 0–100
  reasons: string[];
  stalledValue: number; // valor parado: fases pendentes + propostas em aberto
  breakdown: { monthsAway: number; pendingTreatment: number; recallOverdue: number; noShow: number };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function pluralMeses(n: number) {
  return `${n} ${n === 1 ? "mês" : "meses"}`;
}

export function computeChurnScore(input: PatientRiskInput, w: ChurnWeights = DEFAULT_CHURN_WEIGHTS): PatientRiskResult {
  const reasons: string[] = [];

  // 1) Tempo sem consulta — cresce linearmente até saturar em monthsForMaxScore.
  let monthsAway = 0;
  if (input.monthsSinceLastVisit === null) {
    monthsAway = w.monthsAway; // cadastrado e nunca veio
    reasons.push("Nunca compareceu a uma consulta");
  } else if (input.monthsSinceLastVisit >= 1) {
    monthsAway = clamp01(input.monthsSinceLastVisit / w.monthsForMaxScore) * w.monthsAway;
    if (input.monthsSinceLastVisit >= 3) {
      reasons.push(`Sem consulta há ${pluralMeses(Math.floor(input.monthsSinceLastVisit))}`);
    }
  }

  // 2) Tratamento aprovado e não concluído.
  let pendingTreatment = 0;
  const pendingValue = input.pendingTreatments.reduce((s, t) => s + t.value, 0);
  if (input.pendingTreatments.length > 0) {
    pendingTreatment = w.pendingTreatment;
    const names = [...new Set(input.pendingTreatments.map((t) => t.name))];
    const shown = names.slice(0, 2).join(" e ") + (names.length > 2 ? ` (+${names.length - 2})` : "");
    reasons.push(names.length > 1 ? `${shown} aprovados e não concluídos` : `${shown} aprovado e não concluído`);
  }

  // 3) Revisão semestral vencida — satura em 2x o intervalo.
  let recallOverdue = 0;
  const monthsSinceRecall = input.monthsSinceLastRecall ?? input.monthsSinceLastVisit;
  if (monthsSinceRecall !== null && monthsSinceRecall > w.recallIntervalMonths) {
    const overdueBy = monthsSinceRecall - w.recallIntervalMonths;
    recallOverdue = clamp01(overdueBy / w.recallIntervalMonths) * w.recallOverdue;
    reasons.push(`Revisão semestral vencida há ${pluralMeses(Math.max(1, Math.floor(overdueBy)))}`);
  }

  // 4) Histórico de faltas — taxa de no-show, com piso de 3 consultas p/ evitar ruído.
  let noShow = 0;
  if (input.appointmentCount >= 3 && input.noShowCount > 0) {
    const rate = input.noShowCount / input.appointmentCount;
    noShow = clamp01(rate / 0.5) * w.noShow; // 50% de faltas = peso máximo
    if (rate >= 0.25) {
      reasons.push(`Faltou em ${input.noShowCount} de ${input.appointmentCount} consultas`);
    }
  }

  const raw = monthsAway + pendingTreatment + recallOverdue + noShow;
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  return {
    score,
    reasons,
    stalledValue: Math.round((pendingValue + input.openProposalsValue) * 100) / 100,
    breakdown: {
      monthsAway: Math.round(monthsAway),
      pendingTreatment: Math.round(pendingTreatment),
      recallOverdue: Math.round(recallOverdue),
      noShow: Math.round(noShow),
    },
  };
}

export function monthsBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.4375);
}
