import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { brl, brl0, pct } from "../lib/format";
import { CATEGORY_COLOR, CATEGORY_LABEL, STAGE_LABEL, type Category, type Dashboard as DashboardData } from "../lib/types";
import { Badge, Card, Delta, Spinner, StatTile, cx } from "../components/ui";
import { PlanoAcaoModal } from "../components/PlanoAcaoModal";

export default function Dashboard() {
  const [period, setPeriod] = useState<"month" | "quarter">("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = (p: typeof period) => api.get<DashboardData>(`/dashboard?period=${p}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    setData(null);
    void load(period);
  }, [period]);

  if (error) return <p className="p-8 text-rose">{error}</p>;

  const k = data?.kpis;
  const catTotal = data ? Object.values(data.revenueByCategory).reduce((s, v) => s + v, 0) : 0;
  const cats = (["clinico", "funcional", "estetico"] as Category[]).map((c) => ({ key: c, label: CATEGORY_LABEL[c], value: data?.revenueByCategory[c] ?? 0 }));

  const dentists = data?.dentists ?? [];
  const topAccepted = Math.max(1, ...dentists.map((d) => d.acceptedValue));
  const soldTotal = dentists.reduce((s, d) => s + d.acceptedValue, 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Visão geral</h1>
          <p className="mt-1 text-sm text-ink-2">O que aconteceu com as propostas e com os pacientes nos últimos {period === "month" ? "30" : "90"} dias.</p>
        </div>
        <div className="inline-flex rounded-lg border border-line-2 bg-card p-0.5 text-sm">
          {(["month", "quarter"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={cx("rounded-md px-3 py-1.5", period === p ? "bg-ink text-white" : "text-ink-2 hover:text-ink")}>
              {p === "month" ? "30 dias" : "90 dias"}
            </button>
          ))}
        </div>
      </header>

      {!data || !k ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Propostas criadas" value={k.proposalsCreated.value} sub={<Delta value={k.proposalsCreated.value} previous={k.proposalsCreated.previous} />} />
            <StatTile
              label="Taxa de aceitação"
              value={pct(k.acceptanceRate.value)}
              sub={<Delta value={k.acceptanceRate.value === null ? null : k.acceptanceRate.value * 100} previous={k.acceptanceRate.previous === null ? null : k.acceptanceRate.previous * 100} format={(v) => `${v.toFixed(0)} p.p.`} />}
            />
            <StatTile label="Ticket médio" value={brl0(k.avgTicket.value)} sub={<Delta value={k.avgTicket.value} previous={k.avgTicket.previous} format={brl0} />} />
            <StatTile label="Pacientes em risco" value={k.patientsAtRisk.value} tone={k.patientsAtRisk.value > 0 ? "amber" : undefined} sub={`${brl0(k.patientsAtRisk.stalledValue)} parados · ver lista`} to="/risco" />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            <Card title="Propostas por mês" className="lg:col-span-3">
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={data.months} barGap={2} barCategoryGap="28%">
                    <CartesianGrid vertical={false} stroke="#e9edf0" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#4b5563" }} />
                    <YAxis tickLine={false} axisLine={false} width={28} tick={{ fontSize: 12, fill: "#8a94a6" }} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(27,36,48,0.04)" }} contentStyle={{ borderRadius: 8, border: "1px solid #e2e7eb", fontSize: 13 }} formatter={(v, name) => [String(v ?? 0), name === "created" ? "Criadas" : "Aceitas"]} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === "created" ? "Criadas" : "Aceitas")} />
                    <Bar dataKey="created" fill="#9ec5f4" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="accepted" fill="#2a78d6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Valor aceito por categoria" className="lg:col-span-2" action={<span className="text-xs text-mute">{brl0(catTotal)} no período</span>}>
              <ul className="space-y-4">
                {cats.map((c) => (
                  <li key={c.key}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[c.key] }} />
                        {c.label}
                      </span>
                      <span className="num text-ink-2">
                        {brl0(c.value)} <span className="text-mute">· {catTotal ? Math.round((c.value / catTotal) * 100) : 0}%</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-black/6">
                      <div className="h-full rounded-full" style={{ width: `${catTotal ? (c.value / catTotal) * 100 : 0}%`, background: CATEGORY_COLOR[c.key] }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs text-mute">Soma dos itens aceitos no período (com o desconto da proposta), por tipo de tratamento.</p>
            </Card>
          </div>

          <Card title="Dentistas: quem mais vendeu" className="mt-6" action={<span className="text-xs text-mute">{brl0(soldTotal)} aceitos nos últimos {data.periodDays} dias</span>}>
            {dentists.length === 0 ? (
              <p className="text-sm text-mute">Nenhum dentista com propostas no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-mute">
                      <th className="pb-2 font-medium">Dentista</th>
                      <th className="w-[24%] pb-2 font-medium">Valor aceito</th>
                      <th className="whitespace-nowrap pb-2 pl-4 text-right font-medium">Fechadas</th>
                      <th className="whitespace-nowrap pb-2 pl-4 text-right font-medium">Ticket médio</th>
                      <th className="whitespace-nowrap pb-2 pl-4 text-right font-medium">Aceitação</th>
                      <th className="whitespace-nowrap pb-2 pl-4 text-right font-medium">Criadas</th>
                      <th className="whitespace-nowrap pb-2 pl-4 text-right font-medium">Pago confirmado</th>
                      <th className="whitespace-nowrap pb-2 pl-4 text-right font-medium">Em aberto hoje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {dentists.map((d, i) => (
                      <tr key={d.dentistId}>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="num w-4 text-xs text-mute">{i + 1}º</span>
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                            <span className="whitespace-nowrap font-medium">{d.name}</span>
                            {i === 0 && d.acceptedValue > 0 && <Badge tone="green" className="whitespace-nowrap">mais vendeu</Badge>}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="h-2 min-w-28 flex-1 overflow-hidden rounded-full bg-black/6">
                              <div className="h-full rounded-full bg-brand" style={{ width: `${(d.acceptedValue / topAccepted) * 100}%` }} />
                            </div>
                            <span className="num w-20 whitespace-nowrap text-right font-medium">{brl0(d.acceptedValue)}</span>
                          </div>
                        </td>
                        <td className="num whitespace-nowrap py-2.5 pl-4 text-right">{d.acceptedProposals}</td>
                        <td className="num whitespace-nowrap py-2.5 pl-4 text-right">{d.acceptedProposals ? brl0(d.avgTicket) : "–"}</td>
                        <td className="num whitespace-nowrap py-2.5 pl-4 text-right">{pct(d.acceptanceRate)}</td>
                        <td className="num whitespace-nowrap py-2.5 pl-4 text-right text-ink-2">
                          {d.proposalsCreated} <span className="text-mute">· {brl0(d.createdValue)}</span>
                        </td>
                        <td className="num whitespace-nowrap py-2.5 pl-4 text-right text-ink-2">{brl0(d.paidValue)}</td>
                        <td className="num whitespace-nowrap py-2.5 pl-4 text-right text-ink-2">
                          {d.openCount} <span className="text-mute">· {brl0(d.openValue)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 text-xs text-mute">
              Valor aceito = itens aceitos no período, já com o desconto da proposta (aceite parcial conta só a parte aceita). Aceitação = aceitas ÷ (aceitas + perdidas) entre as propostas decididas no período. “Em aberto hoje” é o que ainda está em negociação, independente do período.
            </p>
          </Card>

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            <Card title="Funil de propostas (todas)" className="lg:col-span-3">
              <ol className="grid grid-cols-6 gap-2">
                {(["planejamento", "revisada", "apresentada", "negociacao", "aceita", "perdida"] as const).map((s) => {
                  const f = data.funnel.find((x) => x.stage === s);
                  return (
                    <li key={s} className={cx("rounded-lg p-3", s === "aceita" ? "bg-green-soft" : s === "perdida" ? "bg-rose-soft" : "bg-paper")}>
                      <div className="num text-xl font-semibold">{f?.count ?? 0}</div>
                      <div className="mt-0.5 text-[11px] leading-tight text-ink-2">{STAGE_LABEL[s]}</div>
                      <div className="num mt-1 text-[11px] text-mute">{brl0(f?.value ?? 0)}</div>
                    </li>
                  );
                })}
              </ol>
              <Link to="/propostas" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
                Abrir Kanban
              </Link>
            </Card>

            <Card title="Precisam de retorno" className="lg:col-span-2" action={<Badge tone="amber">apresentadas há mais de 7 dias</Badge>}>
              {data.followUps.length === 0 ? (
                <p className="text-sm text-mute">Nenhuma proposta esperando resposta há mais de 7 dias.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.followUps.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <button type="button" onClick={() => setOpenId(f.id)} className="min-w-0 text-left" title="Abrir plano de ação">
                        <div className="truncate font-medium hover:underline">{f.patient}</div>
                        <div className="truncate text-xs text-mute">{f.dentist}</div>
                      </button>
                      <div className="text-right">
                        <div className="num">{brl(f.total)}</div>
                        <div className="text-xs text-amber">{f.days} dias</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
      <PlanoAcaoModal
        proposalId={openId}
        onClose={(changed) => {
          setOpenId(null);
          if (changed) void load(period);
        }}
      />
    </div>
  );
}
