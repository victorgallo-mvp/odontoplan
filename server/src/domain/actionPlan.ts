// ─────────────────────────────────────────────────────────────────────────────
// Plano de ação — o paciente pode aceitar só parte da proposta. Cada item tem
// uma decisão (pendente / aceito / recusado) e, se aceito, pode estar pago.
// Tudo determinístico; nunca passa por IA.
// ─────────────────────────────────────────────────────────────────────────────
import { round2 } from "./money.js";
import type { ItemDecision, Stage } from "./types.js";

export interface DecisionItem {
  total: number;
  decision: string;
  paidAt: Date | string | null;
  declineReason?: string | null;
}

export interface ActionPlanBucket {
  count: number;
  value: number;
}

export interface ActionPlanSummary {
  /** Aceitos (pagos ou não). */
  accepted: ActionPlanBucket;
  /** Aceitos com pagamento confirmado. */
  paid: ActionPlanBucket;
  /** Aceitos ainda sem pagamento confirmado. */
  toReceive: ActionPlanBucket;
  pending: ActionPlanBucket;
  declined: ActionPlanBucket;
  /** true quando há mistura de decisões (nem tudo aceito, nem tudo recusado/pendente). */
  partial: boolean;
}

/**
 * Soma os itens por situação. `discountFactor` = total / subtotal da proposta:
 * distribui o desconto adicional (em R$) proporcionalmente entre os itens, para
 * que aceito + pendente + recusado feche com o total da proposta.
 */
export function summarizeActionPlan(items: DecisionItem[], discountFactor = 1): ActionPlanSummary {
  const sum = (list: DecisionItem[]): ActionPlanBucket => ({ count: list.length, value: round2(list.reduce((s, i) => s + i.total, 0) * discountFactor) });
  const accepted = items.filter((i) => i.decision === "aceito");
  const paid = accepted.filter((i) => i.paidAt);
  const pending = items.filter((i) => i.decision !== "aceito" && i.decision !== "recusado");
  const declined = items.filter((i) => i.decision === "recusado");
  return {
    accepted: sum(accepted),
    paid: sum(paid),
    toReceive: sum(accepted.filter((i) => !i.paidAt)),
    pending: sum(pending),
    declined: sum(declined),
    partial: accepted.length > 0 && accepted.length < items.length,
  };
}

export function discountFactorOf(p: { subtotal: number; total: number }): number {
  return p.subtotal > 0 ? p.total / p.subtotal : 1;
}

/**
 * Etapa do Kanban que decorre das decisões dos itens: enquanto houver item
 * pendente a proposta segue aberta (null = não mexe); com tudo decidido, vira
 * "aceita" se ao menos um item foi aceito, senão "perdida".
 */
export function stageFromDecisions(items: { decision: string }[]): Extract<Stage, "aceita" | "perdida"> | null {
  if (items.length === 0) return null;
  if (items.some((i) => i.decision !== "aceito" && i.decision !== "recusado")) return null;
  return items.some((i) => i.decision === "aceito") ? "aceita" : "perdida";
}

/** Motivo de recusa mais citado (para o lostReason da proposta). */
export function mainDeclineReason(items: { decision: string; declineReason?: string | null }[]): string | null {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (i.decision !== "recusado" || !i.declineReason) continue;
    counts.set(i.declineReason, (counts.get(i.declineReason) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function isDecision(v: string): v is ItemDecision {
  return v === "pendente" || v === "aceito" || v === "recusado";
}
