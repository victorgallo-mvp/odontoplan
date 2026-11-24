// ─────────────────────────────────────────────────────────────────────────────
// Simulador de pagamento — 100% determinístico. Nunca passa por IA.
// ─────────────────────────────────────────────────────────────────────────────
import { round2 } from "./money.js";
import type { PaymentMethod } from "./types.js";

export interface CardFeeTier {
  installments: number;
  feePct: number; // taxa da maquininha, em %
}

export interface PaymentConfig {
  cashDiscountPct: number; // desconto à vista (pix/dinheiro), em %
  passCardFeeToPatient: boolean; // repassa taxa da maquininha ao paciente?
  minDownPaymentPct: number; // entrada mínima no parcelamento próprio, em %
  /** "pct" (default) usa minDownPaymentPct; "fixed" usa minDownPaymentFixed em R$. */
  minDownPaymentMode?: "pct" | "fixed";
  minDownPaymentFixed?: number;
  maxOwnInstallments: number; // máx. de parcelas no boleto/pix próprio
  cardFees: CardFeeTier[];
}

export interface PaymentScenario {
  method: PaymentMethod;
  label: string;
  installments: number;
  /** Entrada (apenas boleto/pix próprio). */
  downPayment: number;
  /** Valor de cada parcela (sem a entrada). */
  installmentValue: number;
  /** Valor total que o paciente paga. */
  total: number;
  /** Diferença em relação ao valor base da proposta (negativo = desconto). */
  delta: number;
  /** Taxa aplicada (cartão) ou desconto (à vista), em %. */
  ratePct: number;
  /** Quanto a clínica efetivamente recebe (líquido da maquininha). */
  clinicNet: number;
}

export const DEFAULT_CARD_FEES: CardFeeTier[] = [
  { installments: 1, feePct: 3.19 },
  { installments: 2, feePct: 4.59 },
  { installments: 3, feePct: 5.19 },
  { installments: 4, feePct: 5.79 },
  { installments: 5, feePct: 6.39 },
  { installments: 6, feePct: 6.99 },
  { installments: 7, feePct: 7.59 },
  { installments: 8, feePct: 8.19 },
  { installments: 9, feePct: 8.79 },
  { installments: 10, feePct: 9.39 },
  { installments: 11, feePct: 9.99 },
  { installments: 12, feePct: 10.59 },
];

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  cashDiscountPct: 10,
  passCardFeeToPatient: true,
  minDownPaymentPct: 20,
  maxOwnInstallments: 10,
  cardFees: DEFAULT_CARD_FEES,
};

export function cardFeeFor(installments: number, cfg: PaymentConfig): number {
  if (installments < 1) throw new Error("installments deve ser >= 1");
  const sorted = [...cfg.cardFees].sort((a, b) => a.installments - b.installments);
  const exact = sorted.find((t) => t.installments === installments);
  if (exact) return exact.feePct;
  // Sem tier exato: usa o maior tier <= n (tabela "até N parcelas").
  const below = sorted.filter((t) => t.installments <= installments).pop();
  if (below) return below.feePct;
  throw new Error(`Sem taxa configurada para ${installments}x`);
}

export function maxCardInstallments(cfg: PaymentConfig): number {
  return Math.max(...cfg.cardFees.map((t) => t.installments));
}

/** À vista (pix/dinheiro) com desconto configurável. */
export function cashScenario(baseTotal: number, cfg: PaymentConfig): PaymentScenario {
  const total = round2(baseTotal * (1 - cfg.cashDiscountPct / 100));
  return {
    method: "avista",
    label: "À vista (Pix/dinheiro)",
    installments: 1,
    downPayment: 0,
    installmentValue: total,
    total,
    delta: round2(total - baseTotal),
    ratePct: -cfg.cashDiscountPct,
    clinicNet: total,
  };
}

/**
 * Cartão de crédito em N vezes. Se `passCardFeeToPatient`, o valor é
 * "grossed-up" para que a clínica receba o valor base líquido:
 *   total = base / (1 - taxa)
 */
export function cardScenario(baseTotal: number, installments: number, cfg: PaymentConfig): PaymentScenario {
  const feePct = cardFeeFor(installments, cfg);
  const total = cfg.passCardFeeToPatient ? round2(baseTotal / (1 - feePct / 100)) : round2(baseTotal);
  const installmentValue = round2(total / installments);
  return {
    method: "cartao",
    label: `Cartão em ${installments}x`,
    installments,
    downPayment: 0,
    installmentValue,
    total,
    delta: round2(total - baseTotal),
    ratePct: feePct,
    clinicNet: round2(total * (1 - feePct / 100)),
  };
}

/**
 * Parcelamento próprio da clínica (boleto/pix): entrada mínima + N parcelas
 * sem juros. Lança erro se violar a config.
 */
export function ownInstallmentScenario(
  baseTotal: number,
  installments: number,
  downPayment: number,
  cfg: PaymentConfig,
): PaymentScenario {
  if (installments < 1 || installments > cfg.maxOwnInstallments) {
    throw new Error(`Parcelamento próprio permite de 1 a ${cfg.maxOwnInstallments}x`);
  }
  const minDown = minimumDownPayment(baseTotal, cfg);
  if (downPayment + 0.005 < minDown) {
    const money = `R$ ${minDown.toFixed(2)}`;
    throw new Error(cfg.minDownPaymentMode === "fixed" ? `Entrada mínima é de ${money}` : `Entrada mínima é ${cfg.minDownPaymentPct}% (${money})`);
  }
  if (downPayment > baseTotal) throw new Error("Entrada maior que o total");
  const remaining = round2(baseTotal - downPayment);
  const installmentValue = round2(remaining / installments);
  return {
    method: "boleto",
    label: `Entrada + ${installments}x no boleto/pix`,
    installments,
    downPayment: round2(downPayment),
    installmentValue,
    total: round2(baseTotal),
    delta: 0,
    ratePct: 0,
    clinicNet: round2(baseTotal),
  };
}

/** Entrada mínima em R$: % do total ou valor fixo (limitado ao total). */
export function minimumDownPayment(baseTotal: number, cfg: PaymentConfig): number {
  if (cfg.minDownPaymentMode === "fixed") return round2(Math.min(Math.max(0, cfg.minDownPaymentFixed ?? 0), baseTotal));
  return round2(baseTotal * (cfg.minDownPaymentPct / 100));
}

/** Converte uma entrada informada em % do total para R$. */
export function downPaymentFromPct(baseTotal: number, pct: number): number {
  return round2(baseTotal * (Math.min(100, Math.max(0, pct)) / 100));
}

export interface ScenarioOptions {
  cardInstallments?: number; // default: máximo configurado
  ownInstallments?: number; // default: máximo configurado
  downPayment?: number; // default: entrada mínima
}

/** Os 3 cenários padrão exibidos lado a lado na tela de plano. */
export function buildScenarios(baseTotal: number, cfg: PaymentConfig, opts: ScenarioOptions = {}): PaymentScenario[] {
  const cardN = opts.cardInstallments ?? maxCardInstallments(cfg);
  const ownN = opts.ownInstallments ?? cfg.maxOwnInstallments;
  const down = opts.downPayment ?? minimumDownPayment(baseTotal, cfg);
  return [
    cashScenario(baseTotal, cfg),
    cardScenario(baseTotal, cardN, cfg),
    ownInstallmentScenario(baseTotal, ownN, down, cfg),
  ];
}

/** Recalcula um cenário a partir da condição salva numa proposta. */
export function scenarioFromCondition(
  baseTotal: number,
  method: PaymentMethod,
  installments: number,
  downPayment: number,
  cfg: PaymentConfig,
): PaymentScenario {
  switch (method) {
    case "avista":
      return cashScenario(baseTotal, cfg);
    case "cartao":
      return cardScenario(baseTotal, installments, cfg);
    case "boleto":
      return ownInstallmentScenario(baseTotal, installments, downPayment, cfg);
  }
}

/** Alerta visual quando o preço praticado sai da tolerância (±10% default). */
export function priceDeviation(unitPrice: number, referencePrice: number): number {
  if (referencePrice <= 0) return 0;
  return round2(((unitPrice - referencePrice) / referencePrice) * 100);
}

export function isOutOfTolerance(unitPrice: number, referencePrice: number, tolerancePct: number): boolean {
  return Math.abs(priceDeviation(unitPrice, referencePrice)) > tolerancePct;
}
