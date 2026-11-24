import { describe, expect, it } from "vitest";
import { DEFAULT_CHURN_WEIGHTS, computeChurnScore, monthsBetween } from "./churn.js";

const base = {
  monthsSinceLastVisit: 1,
  monthsSinceLastRecall: 1,
  pendingTreatments: [],
  openProposalsValue: 0,
  noShowCount: 0,
  appointmentCount: 4,
};

describe("computeChurnScore", () => {
  it("paciente ativo e em dia tem score baixo e sem motivos", () => {
    const r = computeChurnScore(base);
    expect(r.score).toBeLessThanOrEqual(5);
    expect(r.reasons).toEqual([]);
  });

  it("satura o fator tempo em 12 meses e descreve o motivo", () => {
    const r = computeChurnScore({ ...base, monthsSinceLastVisit: 11, monthsSinceLastRecall: 11 });
    expect(r.breakdown.monthsAway).toBe(41); // 11/12 * 45
    expect(r.reasons[0]).toBe("Sem consulta há 11 meses");
    const sat = computeChurnScore({ ...base, monthsSinceLastVisit: 24, monthsSinceLastRecall: 24 });
    expect(sat.breakdown.monthsAway).toBe(45);
    expect(sat.breakdown.recallOverdue).toBe(15);
  });

  it("soma tratamento pendente, revisão vencida e faltas; nunca passa de 100", () => {
    const r = computeChurnScore({
      monthsSinceLastVisit: 14,
      monthsSinceLastRecall: 14,
      pendingTreatments: [{ name: "Clareamento de consultório", value: 1100, phaseName: "Fase 2" }],
      openProposalsValue: 500,
      noShowCount: 3,
      appointmentCount: 5,
    });
    expect(r.score).toBe(100);
    expect(r.stalledValue).toBe(1600);
    expect(r.reasons).toContain("Clareamento de consultório aprovado e não concluído");
    const multi = computeChurnScore({ ...base, pendingTreatments: [{ name: "Implante", value: 1, phaseName: "F2" }, { name: "Coroa", value: 1, phaseName: "F2" }] });
    expect(multi.reasons).toContain("Implante e Coroa aprovados e não concluídos");
    expect(r.reasons).toContain("Faltou em 3 de 5 consultas");
  });

  it("paciente que nunca veio recebe peso máximo de tempo", () => {
    const r = computeChurnScore({ ...base, monthsSinceLastVisit: null, monthsSinceLastRecall: null, appointmentCount: 0 });
    expect(r.breakdown.monthsAway).toBe(DEFAULT_CHURN_WEIGHTS.monthsAway);
    expect(r.reasons).toContain("Nunca compareceu a uma consulta");
  });

  it("ignora no-show com menos de 3 consultas (ruído)", () => {
    const r = computeChurnScore({ ...base, noShowCount: 1, appointmentCount: 2 });
    expect(r.breakdown.noShow).toBe(0);
  });

  it("pesos são configuráveis", () => {
    const r = computeChurnScore(
      { ...base, pendingTreatments: [{ name: "Implante", value: 3500, phaseName: "Fase 2" }] },
      { ...DEFAULT_CHURN_WEIGHTS, pendingTreatment: 60 },
    );
    expect(r.breakdown.pendingTreatment).toBe(60);
  });
});

describe("monthsBetween", () => {
  it("calcula meses aproximados", () => {
    expect(monthsBetween(new Date("2026-01-01"), new Date("2026-07-01"))).toBeCloseTo(5.95, 1);
  });
});
