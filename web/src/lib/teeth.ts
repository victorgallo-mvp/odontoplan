// Notação FDI (ISO 3950). Ordem de exibição: da direita do paciente para a
// esquerda, como no odontograma visto de frente.
export const UPPER_PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_PERMANENT = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const UPPER_DECIDUOUS = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
export const LOWER_DECIDUOUS = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

const VALID = new Set([...UPPER_PERMANENT, ...LOWER_PERMANENT, ...UPPER_DECIDUOUS, ...LOWER_DECIDUOUS]);
const ORDER = new Map([...UPPER_PERMANENT, ...LOWER_PERMANENT, ...UPPER_DECIDUOUS, ...LOWER_DECIDUOUS].map((t, i) => [t, i]));

export const isDeciduous = (t: number) => t >= 51;
export const isUpper = (t: number) => [1, 2, 5, 6].includes(Math.floor(t / 10));

export type ToothKind = "molar" | "premolar" | "canino" | "incisivo";
export function toothKind(t: number): ToothKind {
  const pos = t % 10;
  if (isDeciduous(t)) return pos >= 4 ? "molar" : pos === 3 ? "canino" : "incisivo";
  return pos >= 6 ? "molar" : pos >= 4 ? "premolar" : pos === 3 ? "canino" : "incisivo";
}

/** Extrai os dentes (FDI) de um texto livre como "16, 26" ou "dentes 11 e 21". */
export function parseTeeth(text: string | null | undefined): number[] {
  if (!text) return [];
  const found = new Set<number>();
  for (const m of text.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (m[0].length === 2 && VALID.has(n)) found.add(n);
  }
  return sortTeeth([...found]);
}

export const sortTeeth = (teeth: number[]) => [...teeth].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
export const formatTeeth = (teeth: number[]) => sortTeeth(teeth).join(", ");

/** O que sobra do texto depois de tirar os dentes (ex.: "Superior", "Q1"). */
export function regionNote(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\b\d{2}\b/g, (m) => (VALID.has(Number(m)) ? "" : m))
    .replace(/(\s*[,;·]\s*)+/g, ", ")
    .replace(/^[\s,;·]+|[\s,;·]+$/g, "")
    .trim();
}

export function joinRegion(teeth: number[], note: string): string {
  return [formatTeeth(teeth), note.trim()].filter(Boolean).join(" · ");
}

/** Cores por dente a partir dos itens (uma cor por tipo de tratamento presente no dente). */
export function toothFillsOf<T>(items: T[], regionOf: (i: T) => string | null | undefined, colorOf: (i: T) => string): Record<number, string[]> {
  const map: Record<number, string[]> = {};
  for (const it of items) {
    const color = colorOf(it);
    for (const t of parseTeeth(regionOf(it))) if (!(map[t] ??= []).includes(color)) map[t].push(color);
  }
  return map;
}
