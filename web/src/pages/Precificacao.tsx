import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { brl0, pct } from "../lib/format";
import { CATEGORY_COLOR, type InstallmentCell, type Pricing } from "../lib/types";
import { Badge, Card, Select, Spinner, cx, useToast } from "../components/ui";

const TICKETS = ["até R$ 1.000", "R$ 1.000 – 3.000", "R$ 3.000 – 8.000", "acima de R$ 8.000"];
const INSTALLMENTS = ["à vista", "2–5x", "6–10x", "11x+"];

function heat(rate: number | null, count: number) {
  if (rate === null || count === 0) return { background: "#f4f6f7", color: "#8a94a6" };
  // sequencial em um só matiz (teal), claro → escuro
  const a = 0.12 + rate * 0.78;
  return { background: `rgba(15,118,110,${a.toFixed(2)})`, color: rate > 0.45 ? "#fff" : "#134e4a" };
}

function Heatmap({ cells, title, subtitle }: { cells: InstallmentCell[]; title: string; subtitle: string }) {
  const get = (t: string, n: string) => cells.find((c) => c.ticketBand === t && c.installmentsBand === n);
  return (
    <Card title={title}>
      <p className="-mt-2 mb-4 text-xs text-mute">{subtitle}</p>
      <div className="grid gap-1" style={{ gridTemplateColumns: "140px repeat(4, minmax(0, 1fr))" }}>
        <div />
        {INSTALLMENTS.map((n) => (
          <div key={n} className="pb-1 text-center text-xs font-medium text-ink-2">
            {n}
          </div>
        ))}
        {TICKETS.map((t) => (
          <>
            <div key={`${t}-label`} className="flex items-center pr-2 text-xs text-ink-2">
              {t}
            </div>
            {INSTALLMENTS.map((n) => {
              const c = get(t, n);
              const rate = c?.acceptanceRate ?? null;
              const count = c?.count ?? 0;
              return (
                <div key={`${t}-${n}`} className="flex h-14 flex-col items-center justify-center rounded-md" style={heat(rate, count)} title={`${t} · ${n}: ${count} propostas decididas`}>
                  <span className="num text-base font-semibold">{count ? pct(rate) : "–"}</span>
                  <span className="num text-[10px] opacity-80">{count ? `n=${count}` : "sem dados"}</span>
                </div>
              );
            })}
          </>
        ))}
      </div>
    </Card>
  );
}

export default function Precificacao() {
  const toast = useToast();
  const [data, setData] = useState<Pricing | null>(null);
  const [procId, setProcId] = useState<string>("");
  const [implantOnly, setImplantOnly] = useState(false);

  useEffect(() => {
    api
      .get<Pricing>("/pricing")
      .then((d) => {
        setData(d);
        const clar = d.bands.find((b) => b.procedureName.startsWith("Clareamento de consult"));
        setProcId(clar?.procedureId ?? d.bands[0]?.procedureId ?? "");
      })
      .catch((e) => toast(e.message, "error"));
  }, [toast]);

  const report = useMemo(() => data?.bands.find((b) => b.procedureId === procId) ?? null, [data, procId]);

  if (!data) return <Spinner />;
  const split = data.clareamentoSplit;

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Diagnóstico de precificação</h1>
        <p className="mt-1 text-sm text-ink-2">
          Taxa de aceitação = aceitas ÷ (aceitas + perdidas). Propostas pendentes ficam de fora. Base: {data.totals.decided} propostas decididas de {data.totals.proposals}.
        </p>
      </header>

      {data.highlights.length > 0 && (
        <section className="mb-6 grid gap-3 md:grid-cols-2">
          {data.highlights.map((h, i) => (
            <div key={i} className={cx("rounded-xl border-l-4 bg-card p-4 shadow-[var(--shadow-card)]", h.severity === "warning" ? "border-amber" : "border-brand")}>
              <div className="text-sm font-semibold leading-snug">{h.title}</div>
              <p className="mt-1 text-[13px] text-ink-2">{h.detail}</p>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          title="Aceitação por faixa de preço"
          className="lg:col-span-3"
          action={
            <Select value={procId} onChange={(e) => setProcId(e.target.value)} className="h-9 w-64 text-[13px]">
              {data.bands.map((b) => (
                <option key={b.procedureId} value={b.procedureId}>
                  {b.procedureName} ({b.decided})
                </option>
              ))}
            </Select>
          }
        >
          {report ? (
            <>
              <p className="-mt-2 mb-3 text-xs text-mute">Faixas automáticas por quartil do preço praticado. Barras mostram a taxa de aceitação; n = propostas decididas na faixa.</p>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={report.bands.map((b) => ({ ...b, rate: b.acceptanceRate === null ? 0 : Math.round(b.acceptanceRate * 100) }))} barCategoryGap="30%">
                    <CartesianGrid vertical={false} stroke="#e9edf0" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#4b5563" }} interval={0} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={30} tick={{ fontSize: 11, fill: "#8a94a6" }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip cursor={{ fill: "rgba(27,36,48,0.04)" }} contentStyle={{ borderRadius: 8, border: "1px solid #e2e7eb", fontSize: 13 }} formatter={(v, _n, item) => { const pl = (item as { payload?: { count: number; avgPrice: number } }).payload; return [`${v}% (n=${pl?.count ?? 0}, preço médio ${brl0(pl?.avgPrice ?? 0)})`, "Aceitação"]; }} />
                    <Bar dataKey="rate" fill={CATEGORY_COLOR[report.category]} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      <LabelList dataKey="count" position="top" formatter={(v) => `n=${String(v ?? "")}`} style={{ fontSize: 11, fill: "#8a94a6" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs text-mute">
                  <tr>
                    <th className="py-1 font-medium">Faixa</th>
                    <th className="py-1 text-right font-medium">Preço médio</th>
                    <th className="py-1 text-right font-medium">Decididas</th>
                    <th className="py-1 text-right font-medium">Aceitas</th>
                    <th className="py-1 text-right font-medium">Aceitação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.bands.map((b) => (
                    <tr key={b.label}>
                      <td className="py-1.5">{b.label}</td>
                      <td className="num py-1.5 text-right">{brl0(b.avgPrice)}</td>
                      <td className="num py-1.5 text-right">{b.count}</td>
                      <td className="num py-1.5 text-right">{b.accepted}</td>
                      <td className="num py-1.5 text-right font-medium">{pct(b.acceptanceRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-sm text-mute">Procedimento sem decisões suficientes (mínimo 8).</p>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {split && (
            <Card title={`${split.procedureName}: corte em ${brl0(split.threshold)}`}>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-green-soft p-3">
                  <div className="text-xs text-ink-2">abaixo de {brl0(split.threshold)}</div>
                  <div className="num text-2xl font-semibold text-green">{pct(split.below.acceptanceRate)}</div>
                  <div className="text-xs text-mute">n={split.below.count}</div>
                </div>
                <div className="rounded-lg bg-rose-soft p-3">
                  <div className="text-xs text-ink-2">a partir de {brl0(split.threshold)}</div>
                  <div className="num text-2xl font-semibold text-rose">{pct(split.above.acceptanceRate)}</div>
                  <div className="text-xs text-mute">n={split.above.count}</div>
                </div>
              </div>
              <p className="mt-3 text-xs text-mute">Corte fixo para acompanhar a hipótese de reposicionamento do clareamento.</p>
            </Card>
          )}

          <Card title="Por dentista">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-mute">
                <tr>
                  <th className="py-1 font-medium">Dentista</th>
                  <th className="py-1 text-right font-medium">Ticket médio</th>
                  <th className="py-1 text-right font-medium">Desconto</th>
                  <th className="py-1 text-right font-medium">Aceitação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.dentists.map((d) => (
                  <tr key={d.dentistId}>
                    <td className="py-2">
                      <div className="font-medium">{d.dentistName}</div>
                      <div className="text-xs text-mute">{d.proposals} decididas</div>
                    </td>
                    <td className="num py-2 text-right">{brl0(d.avgTicket)}</td>
                    <td className="num py-2 text-right">
                      <span className={cx(d.avgDiscountPct >= 8 && "text-amber font-medium")}>{d.avgDiscountPct.toFixed(1)}%</span>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-black/8">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${(d.acceptanceRate ?? 0) * 100}%` }} />
                        </div>
                        <span className="num w-9 text-right font-medium">{pct(d.acceptanceRate)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-mute">Desconto = quanto o preço praticado fica abaixo da tabela, ponderado pelo valor.</p>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2">
          <button onClick={() => setImplantOnly(false)} className={cx("rounded-full border px-3 py-1 text-xs", !implantOnly ? "border-ink bg-ink text-white" : "border-line-2 bg-card text-ink-2")}>
            Todas as propostas
          </button>
          <button onClick={() => setImplantOnly(true)} className={cx("rounded-full border px-3 py-1 text-xs", implantOnly ? "border-ink bg-ink text-white" : "border-line-2 bg-card text-ink-2")}>
            Só propostas com implante
          </button>
          {implantOnly && <Badge tone="amber">implante converte mal com menos de 6 parcelas</Badge>}
        </div>
        <Heatmap
          cells={implantOnly ? data.installmentsImplant : data.installments}
          title="Aceitação por condição de pagamento × faixa de ticket"
          subtitle="Linhas: valor total da proposta. Colunas: nº de parcelas da condição apresentada. Cor mais escura = aceitação maior."
        />
      </div>
    </div>
  );
}
