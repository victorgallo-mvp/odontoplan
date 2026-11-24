import { useId, useState } from "react";
import { LOWER_DECIDUOUS, LOWER_PERMANENT, UPPER_DECIDUOUS, UPPER_PERMANENT, formatTeeth, isDeciduous, isUpper, joinRegion, sortTeeth, toothKind, type ToothKind } from "../lib/teeth";
import { Button, Field, Input, Modal, cx } from "./ui";

const GAP = 4;
const MID_GAP = 8;
const VIEW_W = 532;
const H = 58; // altura do dente (raiz + coroa)
const LABEL = 14;
const SELECTED = "#0f766e";

// Largura por posição na arcada (1 = incisivo central … 8 = terceiro molar)
const W_PERMANENT = [0, 24, 20, 24, 25, 25, 36, 34, 30];
const W_DECIDUOUS = [0, 20, 18, 20, 26, 30];
function toothWidth(t: number): number {
  const pos = t % 10;
  if (isDeciduous(t)) return W_DECIDUOUS[pos] - (!isUpper(t) && pos <= 2 ? 3 : 0);
  return W_PERMANENT[pos] - (!isUpper(t) && pos <= 2 ? (pos === 1 ? 7 : 2) : 0);
}

// Contornos em coordenadas normalizadas: u = 0..1 na largura; t = 0 no ápice
// da raiz e 1 na borda incisal/oclusal (vista vestibular). Para os dentes
// inferiores o eixo t é espelhado.
const CROWN: Record<ToothKind, string> = {
  incisivo: "M0.2,0.44 C0.1,0.6 0.02,0.82 0.05,0.95 Q0.07,1 0.17,1 L0.83,1 Q0.93,1 0.95,0.95 C0.98,0.82 0.9,0.6 0.8,0.44 Q0.5,0.38 0.2,0.44 Z",
  canino: "M0.22,0.44 C0.08,0.58 0,0.76 0.1,0.88 L0.42,0.985 Q0.5,1.01 0.58,0.985 L0.9,0.88 C1,0.76 0.92,0.58 0.78,0.44 Q0.5,0.38 0.22,0.44 Z",
  premolar: "M0.22,0.46 C0.06,0.56 0,0.8 0.09,0.92 Q0.28,1 0.5,1 Q0.72,1 0.91,0.92 C1,0.8 0.94,0.56 0.78,0.46 Q0.5,0.41 0.22,0.46 Z",
  molar: "M0.14,0.47 C0.02,0.57 0,0.82 0.06,0.92 Q0.14,1 0.28,0.985 Q0.42,0.975 0.5,0.94 Q0.58,0.975 0.72,0.985 Q0.86,1 0.94,0.92 C1,0.82 0.98,0.57 0.86,0.47 Q0.5,0.42 0.14,0.47 Z",
};
const ROOT: Record<ToothKind, string> = {
  incisivo: "M0.24,0.5 C0.28,0.28 0.4,0.04 0.5,0.02 C0.6,0.04 0.72,0.28 0.76,0.5 Z",
  canino: "M0.24,0.5 C0.28,0.25 0.42,0.02 0.5,0 C0.58,0.02 0.72,0.25 0.76,0.5 Z",
  premolar: "M0.26,0.5 C0.3,0.3 0.42,0.08 0.5,0.06 C0.58,0.08 0.7,0.3 0.74,0.5 Z",
  molar: "M0.14,0.52 C0.1,0.34 0.12,0.12 0.22,0.08 C0.32,0.1 0.4,0.3 0.47,0.52 Z M0.53,0.52 C0.6,0.3 0.68,0.1 0.78,0.08 C0.88,0.12 0.9,0.34 0.86,0.52 Z",
};
// Raiz palatina dos molares superiores (aparece entre as duas vestibulares)
const ROOT_PALATAL = "M0.36,0.52 C0.4,0.3 0.46,0.14 0.5,0.12 C0.54,0.14 0.6,0.3 0.64,0.52 Z";
const MOLAR_GROOVE = "M0.5,0.94 L0.5,0.8";

function place(path: string, x: number, w: number, sy: number, upper: boolean): string {
  return path.replace(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_m, u: string, t: string) => {
    const px = x + Number(u) * w;
    const py = upper ? sy + Number(t) * H : sy + (1 - Number(t)) * H;
    return `${px.toFixed(2)},${py.toFixed(2)}`;
  });
}

type Placed = { tooth: number; x: number; w: number };

function layoutRow(teeth: number[]): Placed[] {
  const widths = teeth.map(toothWidth);
  const total = widths.reduce((s, w) => s + w, 0) + GAP * (teeth.length - 1) + MID_GAP;
  let x = VIEW_W / 2 - total / 2;
  return teeth.map((tooth, i) => {
    const placed = { tooth, x, w: widths[i] };
    x += widths[i] + GAP + (i === teeth.length / 2 - 1 ? MID_GAP : 0);
    return placed;
  });
}

export interface OdontogramaProps {
  /** Dentes selecionados (modo seleção). */
  selected?: number[];
  onToggle?: (tooth: number) => void;
  /** Modo apresentação: cores por dente (ex.: uma por tipo de tratamento). */
  fills?: Record<number, string[]>;
  showDeciduous?: boolean;
  className?: string;
  /** Descrição para leitores de tela no modo apresentação. */
  label?: string;
}

export function Odontograma({ selected = [], onToggle, fills, showDeciduous = false, className, label }: OdontogramaProps) {
  const uid = useId().replace(/:/g, "");
  const sel = new Set(selected);
  const interactive = !!onToggle;

  // Linhas: superior permanente, [decíduos sup., decíduos inf.], inferior permanente.
  // Cada linha ocupa H (dente) + LABEL (número, do lado da linha média).
  const rows: { teeth: number[]; top: number; upper: boolean }[] = [];
  let y = 6;
  const push = (teeth: number[], upper: boolean) => {
    rows.push({ teeth, top: y, upper });
    y += H + LABEL + 6;
  };
  push(UPPER_PERMANENT, true);
  if (showDeciduous) push(UPPER_DECIDUOUS, true);
  const midY = y + 5;
  y += 18;
  if (showDeciduous) push(LOWER_DECIDUOUS, false);
  push(LOWER_PERMANENT, false);
  const height = y;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} className={cx("w-full select-none", className)} role={interactive ? "group" : "img"} aria-label={label ?? (interactive ? "Odontograma: selecione os dentes" : "Odontograma")}>
      <line x1={VIEW_W / 2} y1={2} x2={VIEW_W / 2} y2={height - 2} stroke="#cfd6dc" strokeDasharray="3 4" />
      <line x1={112} y1={midY} x2={VIEW_W - 116} y2={midY} stroke="#e2e7eb" />
      <text x={12} y={midY + 3} fontSize={9} fill="#8a94a6">
        direita do paciente
      </text>
      <text x={VIEW_W - 12} y={midY + 3} fontSize={9} fill="#8a94a6" textAnchor="end">
        esquerda do paciente
      </text>
      {rows.map((row) =>
        layoutRow(row.teeth).map(({ tooth, x, w }) => {
          const kind = toothKind(tooth);
          const sy = row.upper ? row.top : row.top + LABEL; // topo do desenho do dente
          const labelY = row.upper ? sy + H + 11 : row.top + 10;
          const d = (path: string) => place(path, x, w, sy, row.upper);
          const crown = d(CROWN[kind]);
          const isSel = sel.has(tooth);
          const colors = isSel ? [SELECTED] : (fills?.[tooth] ?? []);
          const marked = colors.length > 0;
          const clip = `${uid}-t${tooth}`;
          const crownTop = row.upper ? sy + H * 0.36 : sy - 2;
          return (
            <g
              key={tooth}
              className={cx(interactive && "group cursor-pointer outline-none")}
              onClick={interactive ? () => onToggle(tooth) : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        onToggle(tooth);
                      }
                    }
                  : undefined
              }
              role={interactive ? "checkbox" : undefined}
              aria-checked={interactive ? isSel : undefined}
              aria-label={interactive ? `Dente ${tooth}` : undefined}
              tabIndex={interactive ? 0 : undefined}
            >
              {interactive && <rect x={x - 2} y={row.top - 2} width={w + 4} height={H + LABEL + 4} fill="transparent" />}
              <g fill={marked ? "#e3e8ed" : "#eef1f4"} stroke="#a9b3be" strokeWidth={1} strokeLinejoin="round">
                {kind === "molar" && row.upper && <path d={d(ROOT_PALATAL)} fill={marked ? "#d7dee5" : "#e4e9ee"} />}
                <path d={d(ROOT[kind])} />
              </g>
              <clipPath id={clip}>
                <path d={crown} />
              </clipPath>
              <path d={crown} fill="#fff" className={cx(interactive && !marked && "group-hover:fill-brand-soft group-focus-visible:fill-brand-soft")} />
              {colors.map((c, i) => (
                <rect key={c + i} clipPath={`url(#${clip})`} x={x + (w / colors.length) * i} y={crownTop} width={w / colors.length + 0.5} height={H * 0.66 + 2} fill={c} />
              ))}
              {kind === "molar" && <path d={d(MOLAR_GROOVE)} fill="none" stroke={marked ? "#fff" : "#a9b3be"} strokeOpacity={marked ? 0.6 : 0.8} strokeWidth={1} strokeLinecap="round" />}
              <path d={crown} fill="none" stroke={marked ? "#1b2430" : "#8794a3"} strokeOpacity={marked ? 0.6 : 1} strokeWidth={1.2} strokeLinejoin="round" className={cx(interactive && "group-focus-visible:stroke-brand")} />
              <text x={x + w / 2} y={labelY} fontSize={10} textAnchor="middle" fill={marked ? "#1b2430" : "#6b7685"} fontWeight={marked ? 600 : 400} style={{ fontVariantNumeric: "tabular-nums" }}>
                {tooth}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}

/** Legenda de cores para o modo apresentação. */
export function OdontogramaLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Modal de seleção: marca vários dentes para o mesmo procedimento. Devolve o
 * texto "16, 26 · observação" e a quantidade de dentes.
 */
export function ToothPicker({ open, title, initialTeeth, initialNote, onClose, onConfirm }: { open: boolean; title: string; initialTeeth: number[]; initialNote: string; onClose: () => void; onConfirm: (r: { toothRegion: string; teeth: number[]; syncQuantity: boolean }) => void }) {
  const [teeth, setTeeth] = useState<number[]>(initialTeeth);
  const [note, setNote] = useState(initialNote);
  const [deciduous, setDeciduous] = useState(initialTeeth.some(isDeciduous));
  const [syncQuantity, setSyncQuantity] = useState(true);

  const toggle = (t: number) => setTeeth((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : sortTeeth([...cur, t])));
  const toggleGroup = (group: number[]) => setTeeth((cur) => (group.every((t) => cur.includes(t)) ? cur.filter((t) => !group.includes(t)) : sortTeeth([...new Set([...cur, ...group])])));
  const upper = deciduous ? [...UPPER_PERMANENT, ...UPPER_DECIDUOUS] : UPPER_PERMANENT;
  const lower = deciduous ? [...LOWER_PERMANENT, ...LOWER_DECIDUOUS] : LOWER_PERMANENT;
  const chip = "rounded-full border border-line-2 bg-card px-3 py-1 text-xs text-ink-2 hover:bg-paper";

  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-3xl">
      <p className="-mt-2 mb-3 text-sm text-ink-2">Clique nos dentes que recebem este procedimento. Clique de novo para desmarcar.</p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" className={chip} onClick={() => toggleGroup(upper)}>
          Arcada superior
        </button>
        <button type="button" className={chip} onClick={() => toggleGroup(lower)}>
          Arcada inferior
        </button>
        <button type="button" className={chip} onClick={() => toggleGroup([...upper, ...lower])}>
          Todos
        </button>
        <button type="button" className={chip} onClick={() => setTeeth([])}>
          Limpar
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={deciduous} onChange={(e) => setDeciduous(e.target.checked)} />
          Mostrar dentes de leite
        </label>
      </div>
      <div className="rounded-lg border border-line bg-paper/60 p-3">
        <Odontograma selected={teeth} onToggle={toggle} showDeciduous={deciduous} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
        <div>
          <div className="text-[13px] font-medium text-ink-2">
            {teeth.length === 0 ? "Nenhum dente selecionado" : `${teeth.length} ${teeth.length === 1 ? "dente selecionado" : "dentes selecionados"}`}
          </div>
          <div className="num mt-1 min-h-5 text-sm">{formatTeeth(teeth) || "–"}</div>
        </div>
        <Field label="Região / observação (opcional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: Superior, Q1, face vestibular" maxLength={40} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={syncQuantity} onChange={(e) => setSyncQuantity(e.target.checked)} />
          Quantidade = nº de dentes
        </label>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => onConfirm({ toothRegion: joinRegion(teeth, note), teeth, syncQuantity })}>
            Aplicar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
