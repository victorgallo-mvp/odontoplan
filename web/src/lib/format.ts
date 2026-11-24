export const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

export const brl0 = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const pct = (r: number | null | undefined, digits = 0) => (r === null || r === undefined ? "–" : `${(r * 100).toFixed(digits)}%`);

export const dateBR = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString("pt-BR") : "–");

export const dateLong = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }) : "–";

export const daysSince = (d: string | Date | null | undefined) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);

export const ageFrom = (birth: string | null | undefined) => (birth ? Math.floor((Date.now() - new Date(birth).getTime()) / (365.25 * 86_400_000)) : null);

export function relativeDays(d: string | Date | null | undefined): string {
  const n = daysSince(d);
  if (n === null) return "–";
  if (n === 0) return "hoje";
  if (n === 1) return "ontem";
  if (n < 30) return `há ${n} dias`;
  const m = Math.floor(n / 30.4375);
  if (m < 12) return `há ${m} ${m === 1 ? "mês" : "meses"}`;
  const y = Math.floor(m / 12);
  return `há ${y} ${y === 1 ? "ano" : "anos"}`;
}

export const firstName = (name: string) => name.split(" ")[0];

/** "Fase 2 — Reabilitação" a partir de nomes que já podem trazer o prefixo "Fase N —". */
export const phaseTitle = (order: number, name: string) => `Fase ${order} — ${name.replace(/^fase\s*\d+\s*[—–:-]\s*/i, "") || name}`;
