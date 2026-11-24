import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-11 px-5 text-[15px]" };
  const variants: Record<Variant, string> = {
    primary: "bg-brand text-white hover:bg-brand-2",
    secondary: "bg-card text-ink border border-line-2 hover:bg-paper",
    ghost: "text-ink-2 hover:bg-black/5",
    danger: "bg-rose-soft text-rose hover:bg-rose hover:text-white",
  };
  return <button className={cx(base, sizes[size], variants[variant], className)} {...props} />;
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "brand" | "amber" | "rose" | "green"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-black/5 text-ink-2",
    brand: "bg-brand-soft text-brand-2",
    amber: "bg-amber-soft text-amber",
    rose: "bg-rose-soft text-rose",
    green: "bg-green-soft text-green",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium leading-5", tones[tone], className)}>{children}</span>;
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("card p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          {title && <h2 className="min-w-40 flex-1 text-[15px] font-semibold text-ink">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const widthOf = (className?: string) => (className && /(^|\s)w-/.test(className) ? "" : "w-full");

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(widthOf(className), "h-10 rounded-lg border border-line-2 bg-card px-3 text-sm text-ink placeholder:text-mute focus:border-brand", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(widthOf(className), "h-10 rounded-lg border border-line-2 bg-card px-3 text-sm text-ink focus:border-brand", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-mute">{hint}</span>}
    </label>
  );
}

export function StatTile({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "amber" | "rose" | "brand"; to?: string }) {
  const inner = (
    <>
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className={cx("num mt-1 text-[28px] font-semibold leading-tight", tone === "rose" ? "text-rose" : tone === "amber" ? "text-amber" : "text-ink")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-mute">{sub}</div>}
    </>
  );
  return to ? (
    <a href={to} className="card block p-5 transition-colors hover:bg-brand-soft/40">
      {inner}
    </a>
  ) : (
    <div className="card p-5">{inner}</div>
  );
}

export function Delta({ value, previous, format = (v: number) => String(v), invert = false }: { value: number | null; previous: number | null; format?: (v: number) => string; invert?: boolean }) {
  if (value === null || previous === null || previous === 0) return <span>período anterior: {previous === null ? "–" : format(previous)}</span>;
  const diff = value - previous;
  const up = invert ? diff < 0 : diff > 0;
  const sign = diff > 0 ? "+" : "";
  return (
    <span className={diff === 0 ? "" : up ? "text-green" : "text-rose"}>
      {sign}
      {format(diff)} vs período anterior
    </span>
  );
}

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-12 text-sm text-mute" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-2 border-t-brand" />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2 p-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-mute">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-2 sm:items-center sm:p-4" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx("card max-h-[calc(100dvh-1rem)] w-full overflow-y-auto p-4 sm:max-h-[calc(100dvh-2rem)] sm:p-6", width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-mute hover:bg-black/5 hover:text-ink" aria-label="Fechar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────
type Toast = { id: number; message: string; tone: "ok" | "error" };
const ToastCtx = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-3 bottom-4 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4">
        {toasts.map((t) => (
          <div key={t.id} className={cx("rounded-lg px-4 py-2.5 text-sm text-white shadow-lg", t.tone === "ok" ? "bg-ink" : "bg-rose")}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-rose" : score >= 50 ? "bg-amber" : "bg-brand";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-black/8">
        <div className={cx("h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="num w-7 text-right text-sm font-semibold">{score}</span>
    </div>
  );
}
