// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico de precificação — agregações determinísticas sobre itens de
// propostas decididas (aceita/perdida). Propostas pendentes ficam de fora da
// taxa de aceitação.
// ─────────────────────────────────────────────────────────────────────────────
import { round2 } from "./money.js";

export interface PricedItem {
  procedureId: string;
  procedureName: string;
  category: string;
  dentistId: string;
  dentistName: string;
  unitPrice: number;
  referencePrice: number;
  quantity: number;
  /** true = proposta aceita; false = perdida; null = pendente */
  accepted: boolean | null;
  installments: number; // condição da proposta
  proposalTotal: number;
  proposalId: string;
}

export interface PriceBand {
  label: string;
  min: number;
  max: number | null; // null = sem teto
  count: number; // itens decididos
  accepted: number;
  acceptanceRate: number | null; // 0–1, null se count = 0
  avgPrice: number;
}

export interface ProcedureBandReport {
  procedureId: string;
  procedureName: string;
  category: string;
  decided: number;
  bands: PriceBand[];
}

/** Quantil por "nearest rank": o corte é sempre um preço observado. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil(q * sorted.length) - 1);
  return sorted[idx];
}

function fmt(v: number) {
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

/**
 * Bandas automáticas por quartil de preço praticado. Quando os quartis
 * colapsam (poucos preços distintos), as bandas são deduplicadas.
 */
export function buildQuartileBands(prices: number[]): { min: number; max: number | null; label: string }[] {
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const cuts = [...new Set([quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75)].map((c) => round2(c)))];
  const distinct = new Set(sorted).size;
  if (distinct <= 1 || cuts.length === 0) {
    return [{ min: sorted[0], max: null, label: `${fmt(sorted[0])}` }];
  }
  const bands: { min: number; max: number | null; label: string }[] = [];
  let lower = sorted[0];
  for (const cut of cuts) {
    if (cut <= lower) continue;
    bands.push({ min: lower, max: cut, label: `${fmt(lower)} – ${fmt(cut)}` });
    lower = cut;
  }
  bands.push({ min: lower, max: null, label: `acima de ${fmt(lower)}` });
  return bands;
}

export function bandIndexFor(price: number, bands: { min: number; max: number | null }[]): number {
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const last = i === bands.length - 1;
    if (price >= b.min && (last || b.max === null || price < b.max)) return i;
  }
  return Math.max(0, bands.length - 1);
}

/** Taxa de aceitação por procedimento × faixa de preço (bandas por quartil). */
export function acceptanceByPriceBand(items: PricedItem[], minDecided = 8): ProcedureBandReport[] {
  const byProc = new Map<string, PricedItem[]>();
  for (const it of items) {
    if (it.accepted === null) continue;
    const list = byProc.get(it.procedureId) ?? [];
    list.push(it);
    byProc.set(it.procedureId, list);
  }
  const reports: ProcedureBandReport[] = [];
  for (const [procedureId, list] of byProc) {
    if (list.length < minDecided) continue;
    const bandDefs = buildQuartileBands(list.map((i) => i.unitPrice));
    const bands: PriceBand[] = bandDefs.map((b) => ({ ...b, count: 0, accepted: 0, acceptanceRate: null, avgPrice: 0 }));
    const sums = bands.map(() => 0);
    for (const it of list) {
      const idx = bandIndexFor(it.unitPrice, bandDefs);
      bands[idx].count++;
      sums[idx] += it.unitPrice;
      if (it.accepted) bands[idx].accepted++;
    }
    bands.forEach((b, i) => {
      b.acceptanceRate = b.count ? round2(b.accepted / b.count) : null;
      b.avgPrice = b.count ? round2(sums[i] / b.count) : 0;
    });
    reports.push({
      procedureId,
      procedureName: list[0].procedureName,
      category: list[0].category,
      decided: list.length,
      bands,
    });
  }
  return reports.sort((a, b) => b.decided - a.decided);
}

/** Taxa de aceitação de um procedimento com corte fixo (ex.: clareamento em R$ 1.200). */
export function acceptanceSplitAt(items: PricedItem[], procedureId: string, threshold: number) {
  const decided = items.filter((i) => i.procedureId === procedureId && i.accepted !== null);
  const below = decided.filter((i) => i.unitPrice < threshold);
  const above = decided.filter((i) => i.unitPrice >= threshold);
  const rate = (l: PricedItem[]) => (l.length ? round2(l.filter((i) => i.accepted).length / l.length) : null);
  return {
    threshold,
    below: { count: below.length, acceptanceRate: rate(below) },
    above: { count: above.length, acceptanceRate: rate(above) },
  };
}

export interface DentistReport {
  dentistId: string;
  dentistName: string;
  proposals: number; // propostas decididas
  accepted: number;
  acceptanceRate: number | null;
  avgTicket: number; // ticket médio das propostas (todas)
  avgDiscountPct: number; // desconto médio sobre tabela (ponderado por valor)
}

/** Por dentista: ticket médio, % desconto médio sobre tabela, taxa de aceitação. */
export function acceptanceByDentist(items: PricedItem[]): DentistReport[] {
  type Acc = { name: string; proposals: Map<string, { total: number; accepted: boolean | null }>; ref: number; practiced: number };
  const acc = new Map<string, Acc>();
  for (const it of items) {
    const a = acc.get(it.dentistId) ?? { name: it.dentistName, proposals: new Map(), ref: 0, practiced: 0 };
    a.ref += it.referencePrice * it.quantity;
    a.practiced += it.unitPrice * it.quantity;
    a.proposals.set(it.proposalId, { total: it.proposalTotal, accepted: it.accepted });
    acc.set(it.dentistId, a);
  }
  const out: DentistReport[] = [];
  for (const [dentistId, a] of acc) {
    const all = [...a.proposals.values()];
    const decided = all.filter((p) => p.accepted !== null);
    const accepted = decided.filter((p) => p.accepted).length;
    out.push({
      dentistId,
      dentistName: a.name,
      proposals: decided.length,
      accepted,
      acceptanceRate: decided.length ? round2(accepted / decided.length) : null,
      avgTicket: all.length ? round2(all.reduce((s, p) => s + p.total, 0) / all.length) : 0,
      avgDiscountPct: a.ref ? round2(((a.ref - a.practiced) / a.ref) * 100) : 0,
    });
  }
  return out.sort((x, y) => (y.acceptanceRate ?? 0) - (x.acceptanceRate ?? 0));
}

export interface InstallmentCell {
  ticketBand: string;
  installmentsBand: string;
  count: number;
  accepted: number;
  acceptanceRate: number | null;
}

const TICKET_BANDS: { label: string; min: number; max: number | null }[] = [
  { label: "até R$ 1.000", min: 0, max: 1000 },
  { label: "R$ 1.000 – 3.000", min: 1000, max: 3000 },
  { label: "R$ 3.000 – 8.000", min: 3000, max: 8000 },
  { label: "acima de R$ 8.000", min: 8000, max: null },
];
const INSTALLMENT_BANDS: { label: string; min: number; max: number | null }[] = [
  { label: "à vista", min: 1, max: 2 },
  { label: "2–5x", min: 2, max: 6 },
  { label: "6–10x", min: 6, max: 11 },
  { label: "11x+", min: 11, max: null },
];

/** Taxa de aceitação por nº de parcelas × faixa de ticket (nível proposta). */
export function acceptanceByInstallments(items: PricedItem[]): InstallmentCell[] {
  const proposals = new Map<string, { total: number; installments: number; accepted: boolean | null }>();
  for (const it of items) proposals.set(it.proposalId, { total: it.proposalTotal, installments: it.installments, accepted: it.accepted });
  const cells = new Map<string, InstallmentCell>();
  for (const t of TICKET_BANDS)
    for (const n of INSTALLMENT_BANDS)
      cells.set(`${t.label}|${n.label}`, { ticketBand: t.label, installmentsBand: n.label, count: 0, accepted: 0, acceptanceRate: null });
  for (const p of proposals.values()) {
    if (p.accepted === null) continue;
    const t = TICKET_BANDS[bandIndexFor(p.total, TICKET_BANDS)];
    const n = INSTALLMENT_BANDS[bandIndexFor(p.installments, INSTALLMENT_BANDS)];
    const c = cells.get(`${t.label}|${n.label}`)!;
    c.count++;
    if (p.accepted) c.accepted++;
  }
  for (const c of cells.values()) c.acceptanceRate = c.count ? round2(c.accepted / c.count) : null;
  return [...cells.values()];
}

/** Mesma análise filtrada a propostas que contêm um procedimento (ex.: implante). */
export function acceptanceByInstallmentsForProcedure(items: PricedItem[], procedureId: string): InstallmentCell[] {
  const ids = new Set(items.filter((i) => i.procedureId === procedureId).map((i) => i.proposalId));
  return acceptanceByInstallments(items.filter((i) => ids.has(i.proposalId)));
}

export interface Highlight {
  kind: "price_band" | "dentist_discount" | "installments";
  severity: "info" | "warning";
  title: string;
  detail: string;
}

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);

/**
 * Destaques automáticos: frases prontas geradas por regra (não IA).
 */
export function buildHighlights(items: PricedItem[]): Highlight[] {
  const out: Highlight[] = [];

  // 1) Procedimentos cuja aceitação cai forte entre a banda mais barata e a mais cara.
  for (const rep of acceptanceByPriceBand(items)) {
    const valid = rep.bands.filter((b) => b.count >= 4 && b.acceptanceRate !== null);
    if (valid.length < 2) continue;
    const first = valid[0];
    const last = valid[valid.length - 1];
    const drop = (first.acceptanceRate ?? 0) - (last.acceptanceRate ?? 0);
    if (drop >= 0.2) {
      out.push({
        kind: "price_band",
        severity: "warning",
        title: `${rep.procedureName}: aceitação de ${pct(first.acceptanceRate)} ${first.label.startsWith("acima") ? first.label : "até " + fmt(first.max ?? first.min)} vs ${pct(last.acceptanceRate)} ${last.label}`,
        detail: `Queda de ${Math.round(drop * 100)} pontos percentuais entre a faixa mais barata e a mais cara (${rep.decided} propostas decididas). Considere reposicionar o preço ou reforçar a argumentação acima de ${fmt(last.min)}.`,
      });
    }
  }

  // 2) Dentista que desconta mais e converte menos que o que pratica tabela cheia.
  const dentists = acceptanceByDentist(items).filter((d) => d.proposals >= 10);
  if (dentists.length >= 2) {
    const mostDiscount = [...dentists].sort((a, b) => b.avgDiscountPct - a.avgDiscountPct)[0];
    // "tabela cheia" = desconto médio até 3%; entre esses, quem mais converte
    const fullTable = dentists.filter((d) => d.avgDiscountPct <= 3).sort((a, b) => (b.acceptanceRate ?? 0) - (a.acceptanceRate ?? 0));
    const leastDiscount = fullTable[0] ?? [...dentists].sort((a, b) => a.avgDiscountPct - b.avgDiscountPct)[0];
    if (
      mostDiscount.dentistId !== leastDiscount.dentistId &&
      mostDiscount.avgDiscountPct - leastDiscount.avgDiscountPct >= 5 &&
      (mostDiscount.acceptanceRate ?? 0) < (leastDiscount.acceptanceRate ?? 0)
    ) {
      out.push({
        kind: "dentist_discount",
        severity: "warning",
        title: `${mostDiscount.dentistName} desconta em média ${mostDiscount.avgDiscountPct.toFixed(0)}% e converte menos (${pct(mostDiscount.acceptanceRate)}) que ${leastDiscount.dentistName}, que pratica tabela cheia (${pct(leastDiscount.acceptanceRate)})`,
        detail: `Desconto não está comprando conversão. Vale revisar o roteiro de apresentação e as condições de pagamento antes de conceder desconto.`,
      });
    }
  }

  // 3) Parcelamento: tickets altos com poucas parcelas convertendo mal.
  const cells = acceptanceByInstallments(items);
  const high = cells.filter((c) => c.ticketBand.startsWith("R$ 3.000") || c.ticketBand.startsWith("acima"));
  const short = high.filter((c) => c.installmentsBand === "à vista" || c.installmentsBand === "2–5x");
  const long = high.filter((c) => c.installmentsBand === "6–10x" || c.installmentsBand === "11x+");
  const agg = (l: InstallmentCell[]) => {
    const count = l.reduce((s, c) => s + c.count, 0);
    const acc = l.reduce((s, c) => s + c.accepted, 0);
    return { count, rate: count ? acc / count : null };
  };
  const s = agg(short);
  const l = agg(long);
  if (s.count >= 8 && l.count >= 8 && s.rate !== null && l.rate !== null && l.rate - s.rate >= 0.15) {
    out.push({
      kind: "installments",
      severity: "info",
      title: `Tickets acima de R$ 3.000: aceitação de ${pct(l.rate)} com 6x ou mais vs ${pct(s.rate)} com até 5x`,
      detail: `Em tratamentos de alto valor, oferecer parcelamento longo logo na apresentação tende a destravar a decisão.`,
    });
  }

  return out;
}
