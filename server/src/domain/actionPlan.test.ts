import { describe, expect, it } from "vitest";
import { discountFactorOf, mainDeclineReason, stageFromDecisions, summarizeActionPlan } from "./actionPlan.js";

const item = (total: number, decision: string, paid = false, declineReason: string | null = null) => ({ total, decision, paidAt: paid ? new Date() : null, declineReason });

describe("summarizeActionPlan", () => {
  it("separa aceito, pago, a receber, pendente e recusado", () => {
    const s = summarizeActionPlan([item(1000, "aceito", true), item(500, "aceito"), item(300, "pendente"), item(200, "recusado")]);
    expect(s.accepted).toEqual({ count: 2, value: 1500 });
    expect(s.paid).toEqual({ count: 1, value: 1000 });
    expect(s.toReceive).toEqual({ count: 1, value: 500 });
    expect(s.pending).toEqual({ count: 1, value: 300 });
    expect(s.declined).toEqual({ count: 1, value: 200 });
    expect(s.partial).toBe(true);
  });

  it("distribui o desconto adicional proporcionalmente", () => {
    const factor = discountFactorOf({ subtotal: 2000, total: 1800 });
    const s = summarizeActionPlan([item(1000, "aceito"), item(1000, "recusado")], factor);
    expect(s.accepted.value).toBe(900);
    expect(s.declined.value).toBe(900);
  });

  it("não é parcial quando tudo foi aceito ou nada foi aceito", () => {
    expect(summarizeActionPlan([item(100, "aceito"), item(50, "aceito")]).partial).toBe(false);
    expect(summarizeActionPlan([item(100, "pendente"), item(50, "recusado")]).partial).toBe(false);
  });

  it("item pago só conta se estiver aceito", () => {
    expect(summarizeActionPlan([item(100, "recusado", true)]).paid.count).toBe(0);
  });
});

describe("stageFromDecisions", () => {
  it("mantém a proposta aberta enquanto houver item pendente", () => {
    expect(stageFromDecisions([{ decision: "aceito" }, { decision: "pendente" }])).toBeNull();
  });
  it("aceita quando tudo foi decidido e ao menos um item foi aceito", () => {
    expect(stageFromDecisions([{ decision: "aceito" }, { decision: "recusado" }])).toBe("aceita");
  });
  it("perdida quando todos os itens foram recusados", () => {
    expect(stageFromDecisions([{ decision: "recusado" }, { decision: "recusado" }])).toBe("perdida");
  });
  it("sem itens não decide nada", () => {
    expect(stageFromDecisions([])).toBeNull();
  });
});

describe("mainDeclineReason", () => {
  it("devolve o motivo mais citado entre os recusados", () => {
    expect(mainDeclineReason([item(1, "recusado", false, "Preço"), item(1, "recusado", false, "Medo"), item(1, "recusado", false, "Preço"), item(1, "aceito", false, "Medo")])).toBe("Preço");
    expect(mainDeclineReason([item(1, "aceito")])).toBeNull();
  });
});
