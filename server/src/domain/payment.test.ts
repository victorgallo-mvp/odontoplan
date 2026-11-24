import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENT_CONFIG,
  buildScenarios,
  cardFeeFor,
  cardScenario,
  cashScenario,
  downPaymentFromPct,
  minimumDownPayment,
  isOutOfTolerance,
  ownInstallmentScenario,
  priceDeviation,
} from "./payment.js";

const cfg = DEFAULT_PAYMENT_CONFIG;

describe("cashScenario", () => {
  it("aplica desconto à vista configurado", () => {
    const s = cashScenario(1000, cfg);
    expect(s.total).toBe(900);
    expect(s.installmentValue).toBe(900);
    expect(s.delta).toBe(-100);
    expect(s.clinicNet).toBe(900);
  });

  it("arredonda corretamente centavos", () => {
    const s = cashScenario(1234.56, { ...cfg, cashDiscountPct: 7.5 });
    expect(s.total).toBe(1141.97);
  });
});

describe("cardScenario", () => {
  it("repassa a taxa da maquininha: clínica recebe líquido o valor base", () => {
    const s = cardScenario(1000, 12, cfg); // 10.59%
    expect(s.total).toBe(1118.44); // 1000 / (1 - 0.1059)
    expect(s.installmentValue).toBe(93.2);
    expect(s.clinicNet).toBe(1000);
    expect(s.ratePct).toBe(10.59);
  });

  it("sem repasse, o paciente paga o valor base e a clínica absorve a taxa", () => {
    const s = cardScenario(1000, 6, { ...cfg, passCardFeeToPatient: false });
    expect(s.total).toBe(1000);
    expect(s.installmentValue).toBe(166.67);
    expect(s.clinicNet).toBe(930.1);
  });

  it("usa o maior tier <= n quando não há tier exato", () => {
    const partial = { ...cfg, cardFees: [{ installments: 1, feePct: 3 }, { installments: 6, feePct: 7 }] };
    expect(cardFeeFor(4, partial)).toBe(3);
    expect(cardFeeFor(6, partial)).toBe(7);
    expect(cardFeeFor(10, partial)).toBe(7);
  });

  it("rejeita parcelas inválidas", () => {
    expect(() => cardScenario(1000, 0, cfg)).toThrow();
  });
});

describe("ownInstallmentScenario", () => {
  it("entrada + parcelas sem juros fecham o total", () => {
    const s = ownInstallmentScenario(5000, 10, 1000, cfg);
    expect(s.downPayment).toBe(1000);
    expect(s.installmentValue).toBe(400);
    expect(s.total).toBe(5000);
    expect(s.delta).toBe(0);
  });

  it("exige entrada mínima", () => {
    expect(() => ownInstallmentScenario(5000, 10, 500, cfg)).toThrow(/Entrada mínima/);
  });

  it("limita número de parcelas", () => {
    expect(() => ownInstallmentScenario(5000, 11, 1000, cfg)).toThrow(/1 a 10x/);
  });
});

describe("buildScenarios", () => {
  it("devolve 3 cenários (à vista, cartão, próprio) com defaults da config", () => {
    const [cash, card, own] = buildScenarios(3500, cfg);
    expect(cash.method).toBe("avista");
    expect(card.method).toBe("cartao");
    expect(card.installments).toBe(12);
    expect(own.method).toBe("boleto");
    expect(own.installments).toBe(10);
    expect(own.downPayment).toBe(700);
    expect(own.installmentValue).toBe(280);
  });
});

describe("tolerância de preço", () => {
  it("calcula desvio e detecta fora da faixa de ±10%", () => {
    expect(priceDeviation(1100, 1000)).toBe(10);
    expect(isOutOfTolerance(1100, 1000, 10)).toBe(false);
    expect(isOutOfTolerance(1101, 1000, 10)).toBe(true);
    expect(isOutOfTolerance(850, 1000, 10)).toBe(true);
  });
});

describe("entrada mínima em % ou valor fixo", () => {
  it("em % do total (padrão)", () => {
    expect(minimumDownPayment(5000, cfg)).toBe(1000);
  });
  it("em valor fixo, limitado ao total", () => {
    const fixed = { ...cfg, minDownPaymentMode: "fixed" as const, minDownPaymentFixed: 800 };
    expect(minimumDownPayment(5000, fixed)).toBe(800);
    expect(minimumDownPayment(500, fixed)).toBe(500);
    expect(() => ownInstallmentScenario(5000, 4, 700, fixed)).toThrow(/Entrada mínima é de R\$ 800\.00/);
    expect(ownInstallmentScenario(5000, 4, 800, fixed).installmentValue).toBe(1050);
  });
  it("converte entrada informada em % para R$", () => {
    expect(downPaymentFromPct(4321, 30)).toBe(1296.3);
    expect(downPaymentFromPct(1000, 150)).toBe(1000);
  });
});
