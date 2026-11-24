import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { ageFrom, brl, relativeDays } from "../lib/format";
import { parseTeeth, regionNote, toothFillsOf } from "../lib/teeth";
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL, type Category, type Dentist, type PatientLite, type PaymentMethod, type PlanTemplate, type Procedure, type Scenario } from "../lib/types";
import { Badge, Button, Card, Field, Input, Select, cx, useToast } from "../components/ui";
import { Odontograma, OdontogramaLegend, ToothPicker } from "../components/Odontograma";

type Sim = { scenarios: Scenario[]; minDownPayment: number; minDownPaymentPct: number; downPayment: number };

type Item = { key: string; procedureId: string; quantity: number; unitPrice: number; toothRegion: string };
type Phase = { key: string; name: string; items: Item[] };
const PHASE_SUGGESTIONS = ["Urgência e adequação", "Reabilitação", "Estética", "Manutenção"];
let seq = 0;
const nk = () => `k${++seq}`;

export default function NovoPlano() {
  const { clinic } = useClinic();
  const toast = useToast();
  const navigate = useNavigate();
  const tolerance = clinic?.settings.priceAlertTolerancePct ?? 10;

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientLite[]>([]);
  const [patient, setPatient] = useState<PatientLite | null>(null);
  const [dentistId, setDentistId] = useState("");
  const [title, setTitle] = useState("Plano de tratamento");
  const [phases, setPhases] = useState<Phase[]>([{ key: nk(), name: `Fase 1 — ${PHASE_SUGGESTIONS[0]}`, items: [] }]);
  const [discount, setDiscount] = useState(0);
  const [picker, setPicker] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("cartao");
  const [cardN, setCardN] = useState(10);
  const [ownN, setOwnN] = useState(6);
  // Entrada: em R$ ou em % do total; null = usar o mínimo da clínica
  const [downMode, setDownMode] = useState<"brl" | "pct">("pct");
  const [downValue, setDownValue] = useState<number | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [saving, setSaving] = useState(false);
  const [toothFor, setToothFor] = useState<{ phaseKey: string; itemKey: string } | null>(null);
  const [templates, setTemplates] = useState<PlanTemplate[]>([]);

  useEffect(() => {
    api.get<Procedure[]>("/procedures").then(setProcedures);
    api.get<Dentist[]>("/dentists").then((d) => {
      setDentists(d);
      setDentistId((cur) => cur || d[0]?.id || "");
    });
    api.get<PlanTemplate[]>("/plan-templates").then(setTemplates).catch(() => {});
  }, []);

  // Busca de paciente (debounce)
  useEffect(() => {
    if (patient) return;
    const t = setTimeout(() => {
      api.get<PatientLite[]>(`/patients?q=${encodeURIComponent(query)}`).then(setResults);
    }, 200);
    return () => clearTimeout(t);
  }, [query, patient]);

  const procById = useMemo(() => new Map(procedures.map((p) => [p.id, p])), [procedures]);
  const subtotal = useMemo(() => phases.flatMap((p) => p.items).reduce((s, i) => s + i.unitPrice * i.quantity, 0), [phases]);
  const referenceTotal = useMemo(() => phases.flatMap((p) => p.items).reduce((s, i) => s + (procById.get(i.procedureId)?.basePrice ?? 0) * i.quantity, 0), [phases, procById]);
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const itemCount = phases.reduce((s, p) => s + p.items.length, 0);

  // Simulador (debounce)
  const simReq = useRef(0);
  useEffect(() => {
    const id = ++simReq.current;
    const t = setTimeout(() => {
      api
        .post<Sim>("/payment/scenarios", { total, cardInstallments: cardN, ownInstallments: ownN, ...(downValue === null ? {} : downMode === "pct" ? { downPaymentPct: Math.min(100, downValue) } : { downPayment: downValue }) })
        .then((r) => {
          if (id === simReq.current) setSim(r);
        })
        .catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [total, cardN, ownN, downMode, downValue]);

  function switchDownMode(mode: "brl" | "pct") {
    if (mode === downMode) return;
    // converte o valor digitado para a nova unidade
    if (downValue !== null && sim) setDownValue(mode === "pct" ? (total > 0 ? Math.round((sim.downPayment / total) * 1000) / 10 : null) : sim.downPayment);
    setDownMode(mode);
  }

  // Odontograma de cada fase: dentes dos itens daquela fase, coloridos pelo tipo de tratamento
  const categoryOf = (it: Item): Category => procById.get(it.procedureId)?.category ?? "clinico";
  const byCategory = useMemo(() => {
    const sums: Record<Category, number> = { clinico: 0, funcional: 0, estetico: 0 };
    for (const it of phases.flatMap((p) => p.items)) sums[procById.get(it.procedureId)?.category ?? "clinico"] += it.unitPrice * it.quantity;
    return sums;
  }, [phases, procById]);
  const toothItem = toothFor ? phases.find((p) => p.key === toothFor.phaseKey)?.items.find((i) => i.key === toothFor.itemKey) : undefined;

  function applyTemplate(id: string) {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    if (itemCount > 0 && !window.confirm(`Substituir as fases atuais pelo modelo "${tpl.name}"?`)) return;
    const next = tpl.phases
      .map((ph) => ({
        key: nk(),
        name: ph.name,
        items: ph.items.filter((i) => procById.has(i.procedureId)).map((i) => ({ key: nk(), procedureId: i.procedureId, quantity: i.quantity, unitPrice: procById.get(i.procedureId)!.basePrice, toothRegion: "" })),
      }))
      .filter((ph) => ph.items.length);
    if (!next.length) return toast("Os serviços deste modelo não estão mais ativos", "error");
    setPhases(next);
    if (title === "Plano de tratamento") setTitle(tpl.name);
    toast(`Modelo "${tpl.name}" aplicado com os valores atuais da tabela`);
  }

  async function saveAsTemplate() {
    const filled = phases.filter((p) => p.items.length);
    if (!filled.length) return toast("Adicione procedimentos antes de salvar um modelo", "error");
    const name = window.prompt("Nome do modelo de plano:", title)?.trim();
    if (!name) return;
    try {
      const tpl = await api.post<PlanTemplate>("/plan-templates", { name, phases: filled.map((p) => ({ name: p.name, items: p.items.map((i) => ({ procedureId: i.procedureId, quantity: i.quantity })) })) });
      setTemplates((ts) => [...ts, tpl].sort((a, b) => a.name.localeCompare(b.name)));
      toast(`Modelo "${name}" salvo. Gerencie em Configurações.`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function updatePhase(key: string, fn: (p: Phase) => Phase) {
    setPhases((ps) => ps.map((p) => (p.key === key ? fn(p) : p)));
  }
  function addItem(phaseKey: string, proc: Procedure) {
    updatePhase(phaseKey, (p) => ({ ...p, items: [...p.items, { key: nk(), procedureId: proc.id, quantity: 1, unitPrice: proc.basePrice, toothRegion: "" }] }));
    setPicker(null);
  }
  function updateItem(phaseKey: string, itemKey: string, patch: Partial<Item>) {
    updatePhase(phaseKey, (p) => ({ ...p, items: p.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) }));
  }
  function removeItem(phaseKey: string, itemKey: string) {
    updatePhase(phaseKey, (p) => ({ ...p, items: p.items.filter((i) => i.key !== itemKey) }));
  }
  function addPhase() {
    const n = phases.length + 1;
    setPhases((ps) => [...ps, { key: nk(), name: `Fase ${n} — ${PHASE_SUGGESTIONS[Math.min(n - 1, PHASE_SUGGESTIONS.length - 1)]}`, items: [] }]);
  }

  async function generate() {
    if (!patient) return toast("Selecione um paciente", "error");
    if (itemCount === 0) return toast("Adicione ao menos um procedimento", "error");
    const chosen = sim?.scenarios.find((s) => s.method === method);
    setSaving(true);
    try {
      const res = await api.post<{ id: string; textsSource: "ai" | "fallback" }>("/proposals", {
        patientId: patient.id,
        dentistId,
        title,
        phases: phases.filter((p) => p.items.length).map((p) => ({ name: p.name, items: p.items.map((i) => ({ procedureId: i.procedureId, quantity: i.quantity, unitPrice: i.unitPrice, toothRegion: i.toothRegion || null })) })),
        discount,
        paymentMethod: method,
        installments: method === "avista" ? 1 : method === "cartao" ? cardN : ownN,
        downPayment: method === "boleto" ? (chosen?.downPayment ?? sim?.downPayment ?? sim?.minDownPayment ?? 0) : 0,
      });
      toast(res.textsSource === "ai" ? "Proposta criada com textos gerados por IA (rascunho)" : "Proposta criada com textos padrão (rascunho)");
      navigate(`/propostas/${res.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 pb-28 sm:px-8 sm:py-8 lg:pb-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Novo plano de tratamento</h1>
        <p className="mt-1 text-sm text-ink-2">Monte o plano em fases, confira os valores contra a tabela e simule as condições antes de gerar a proposta.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title="Paciente e responsável">
            <div className="grid gap-4 md:grid-cols-[1fr_260px]">
              <div className="relative">
                <Field label="Paciente">
                  {patient ? (
                    <div className="flex items-center justify-between rounded-lg border border-brand/40 bg-brand-soft/50 px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">{patient.name}</div>
                        <div className="text-xs text-ink-2">
                          {[ageFrom(patient.birthDate) !== null ? `${ageFrom(patient.birthDate)} anos` : null, patient.city, patient.phone, patient.lastVisitAt ? `última consulta ${relativeDays(patient.lastVisitAt)}` : "sem consultas"].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => { setPatient(null); setQuery(""); }}>
                        Trocar
                      </Button>
                    </div>
                  ) : (
                    <Input autoFocus placeholder="Buscar por nome ou telefone…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  )}
                </Field>
                {!patient && query.trim().length >= 1 && results.length > 0 && (
                  <ul className="card absolute z-20 mt-1 max-h-72 w-full overflow-y-auto p-1">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button onClick={() => setPatient(r)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-paper">
                          <span>
                            {r.name}
                            <span className="ml-2 text-xs text-mute">{[ageFrom(r.birthDate) !== null ? `${ageFrom(r.birthDate)} anos` : null, r.city].filter(Boolean).join(" · ")}</span>
                          </span>
                          <span className="text-xs text-mute">{r.lastVisitAt ? relativeDays(r.lastVisitAt) : "sem consultas"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Field label="Dentista responsável">
                <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
                  {dentists.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_260px]">
              <Field label="Título do plano">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Começar de um modelo" hint={templates.length === 0 ? "Monte um plano e use “Salvar como modelo”." : undefined}>
                <Select value="" onChange={(e) => applyTemplate(e.target.value)} disabled={templates.length === 0}>
                  <option value="">{templates.length === 0 ? "Nenhum modelo salvo" : "Escolher modelo…"}</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          {phases.map((phase, idx) => (
            <Card
              key={phase.key}
              title={
                <input
                  value={phase.name}
                  onChange={(e) => updatePhase(phase.key, (p) => ({ ...p, name: e.target.value }))}
                  className="-mx-1 w-full rounded-md bg-transparent px-1 text-[15px] font-semibold hover:bg-paper focus:bg-paper"
                  title={phase.name}
                  aria-label={`Nome da fase ${idx + 1}`}
                />
              }
              action={
                phases.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setPhases((ps) => ps.filter((p) => p.key !== phase.key))}>
                    Remover fase
                  </Button>
                )
              }
            >
              {phase.items.length > 0 && (
                <table className="stack w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-mute">
                      <th className="pb-2 font-medium">Procedimento</th>
                      <th className="pb-2 font-medium">Dente / região</th>
                      <th className="pb-2 font-medium">Qtd</th>
                      <th className="pb-2 font-medium">Valor unit.</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {phase.items.map((it) => {
                      const proc = procById.get(it.procedureId);
                      const base = proc?.basePrice ?? 0;
                      const dev = base ? ((it.unitPrice - base) / base) * 100 : 0;
                      const out = Math.abs(dev) > tolerance;
                      return (
                        <tr key={it.key}>
                          <td className="full py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[proc?.category ?? "clinico"] }} />
                              <span className="font-medium">{proc?.name}</span>
                            </div>
                            <div className="pl-4 text-xs text-mute">tabela {brl(base)}</div>
                          </td>
                          <td className="full py-2 pr-3" data-label="Dente / região">
                            <button
                              type="button"
                              onClick={() => setToothFor({ phaseKey: phase.key, itemKey: it.key })}
                              className={cx("flex h-9 w-40 max-md:h-11 max-md:w-full items-center gap-1.5 rounded-lg border px-2.5 text-left text-sm hover:border-brand", it.toothRegion ? "border-line-2 bg-card" : "border-dashed border-line-2 text-mute")}
                              title={it.toothRegion || "Selecionar dentes no odontograma"}
                            >
                              <span aria-hidden className="text-mute">🦷</span>
                              <span className="num truncate">{it.toothRegion || "Selecionar"}</span>
                            </button>
                          </td>
                          <td className="py-2 pr-3" data-label="Quantidade">
                            <Input type="number" min={1} max={32} value={it.quantity} onChange={(e) => updateItem(phase.key, it.key, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="h-9 w-16 max-md:w-full" />
                          </td>
                          <td className="py-2 pr-3" data-label="Valor unitário (R$)">
                            <div className="flex flex-wrap items-center gap-2">
                              <Input type="number" min={0} step={10} value={it.unitPrice} onChange={(e) => updateItem(phase.key, it.key, { unitPrice: Math.max(0, Number(e.target.value) || 0) })} className={cx("num h-9 w-28 max-md:w-full", out && "border-amber bg-amber-soft/60")} />
                              {out && (
                                <Badge tone="amber">
                                  {dev > 0 ? "+" : ""}
                                  {dev.toFixed(0)}% vs tabela
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="num py-2 text-right font-medium max-md:text-left" data-label="Total do item">
                            {brl(it.unitPrice * it.quantity)}
                          </td>
                          <td className="py-2 pl-2 text-right">
                            <button onClick={() => removeItem(phase.key, it.key)} className="rounded p-1 text-mute hover:bg-rose-soft hover:text-rose max-md:px-3 max-md:py-2 max-md:text-sm max-md:text-rose" aria-label="Remover item">
                              <span className="md:hidden">Remover </span>✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {(() => {
                const fills = toothFillsOf(phase.items, (i) => i.toothRegion, (i) => CATEGORY_COLOR[categoryOf(i)]);
                const teeth = Object.keys(fills);
                if (teeth.length === 0) return null;
                const used = CATEGORIES.filter((c) => phase.items.some((i) => categoryOf(i) === c && parseTeeth(i.toothRegion).length > 0));
                return (
                  <div className="mt-4 rounded-lg border border-line bg-paper/50 px-4 py-3">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink-2">
                        Odontograma desta fase · {teeth.length} {teeth.length === 1 ? "dente" : "dentes"}
                      </span>
                      <OdontogramaLegend items={used.map((c) => ({ color: CATEGORY_COLOR[c], label: CATEGORY_LABEL[c] }))} />
                    </div>
                    <Odontograma className="mx-auto max-w-[560px]" fills={fills} showDeciduous={teeth.some((t) => Number(t) >= 51)} label={`Dentes da ${phase.name}: ${teeth.join(", ")}`} />
                  </div>
                );
              })()}
              {picker === phase.key ? (
                <ProcedurePicker procedures={procedures} onPick={(p) => addItem(phase.key, p)} onClose={() => setPicker(null)} />
              ) : (
                <Button size="sm" className={cx(phase.items.length > 0 && "mt-3")} onClick={() => setPicker(phase.key)}>
                  + Adicionar procedimento
                </Button>
              )}
            </Card>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button onClick={addPhase}>+ Nova fase</Button>
            <Button variant="ghost" onClick={() => void saveAsTemplate()} disabled={itemCount === 0}>
              Salvar como modelo
            </Button>
          </div>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Card title="Investimento">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between text-ink-2">
                <dt>Valor de tabela</dt>
                <dd className="num">{brl(referenceTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Valor praticado</dt>
                <dd className="num">{brl(subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Desconto adicional</dt>
                <dd>
                  <Input type="number" min={0} step={50} value={discount} onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))} className="num h-8 w-28 text-right" />
                </dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <dt className="font-semibold">Total</dt>
                <dd className="num text-xl font-semibold">{brl(total)}</dd>
              </div>
            </dl>
            {subtotal > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1.5 text-xs text-mute">Por tipo de tratamento (valor praticado)</div>
                <dl className="space-y-1 text-sm">
                  {CATEGORIES.filter((c) => byCategory[c] > 0).map((c) => (
                    <div key={c} className="flex items-center justify-between">
                      <dt className="flex items-center gap-2 text-ink-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
                        {CATEGORY_LABEL[c]}
                      </dt>
                      <dd className="num">{brl(byCategory[c])}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {referenceTotal > 0 && subtotal - discount < referenceTotal * (1 - tolerance / 100) && (
              <p className="mt-3 rounded-md bg-amber-soft px-3 py-2 text-xs text-amber">
                Total {(((referenceTotal - total) / referenceTotal) * 100).toFixed(0)}% abaixo da tabela.
              </p>
            )}
          </Card>

          <Card title="Simulador de pagamento" className="mt-4">
            <p className="mb-3 text-xs text-mute">Cálculo determinístico com as taxas e regras configuradas da clínica. Escolha a condição sugerida para a proposta.</p>
            <div className="space-y-2">
              {sim?.scenarios.map((s) => {
                const selected = s.method === method;
                return (
                  <button
                    key={s.method}
                    onClick={() => setMethod(s.method)}
                    className={cx("w-full rounded-lg border p-3 text-left transition-colors", selected ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-2")}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className={cx("h-4 w-4 rounded-full border", selected ? "border-brand bg-brand" : "border-line-2")} />
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="num text-lg font-semibold">
                        {s.installments > 1 ? `${s.installments}× ${brl(s.installmentValue)}` : brl(s.total)}
                      </span>
                      <span className="num text-xs text-ink-2">total {brl(s.total)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-mute">
                      {s.method === "avista" && `${Math.abs(s.ratePct)}% de desconto`}
                      {s.method === "cartao" && `taxa ${s.ratePct}% repassada · clínica recebe ${brl(s.clinicNet)}`}
                      {s.method === "boleto" && `entrada ${brl(s.downPayment)} + ${s.installments}× sem juros`}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Parcelas no cartão">
                <Select value={cardN} onChange={(e) => setCardN(Number(e.target.value))}>
                  {(clinic?.cardFeeTiers ?? []).map((t) => (
                    <option key={t.installments} value={t.installments}>
                      {t.installments}× · {t.feePct}%
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Parcelas no boleto/pix">
                <Select value={ownN} onChange={(e) => setOwnN(Number(e.target.value))}>
                  {Array.from({ length: clinic?.settings.maxOwnInstallments ?? 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="entrada" className="text-[13px] font-medium text-ink-2">
                  Entrada no boleto/pix
                </label>
                <div className="flex overflow-hidden rounded-md border border-line-2 text-xs" role="group" aria-label="Unidade da entrada">
                  {(["pct", "brl"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => switchDownMode(m)} aria-pressed={downMode === m} className={cx("px-2.5 py-1 font-medium", downMode === m ? "bg-ink text-white" : "bg-card text-ink-2 hover:bg-paper")}>
                      {m === "pct" ? "%" : "R$"}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                id="entrada"
                type="number"
                min={0}
                max={downMode === "pct" ? 100 : undefined}
                step={downMode === "pct" ? 5 : 50}
                value={downValue ?? (downMode === "pct" ? (sim?.minDownPaymentPct ?? 0) : (sim?.minDownPayment ?? 0))}
                onChange={(e) => setDownValue(e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))}
                className="num"
              />
              <p className="mt-1 text-xs text-mute">
                {sim && total > 0 ? (downMode === "pct" ? `= ${brl(sim.downPayment)}` : `= ${((sim.downPayment / total) * 100).toFixed(1).replace(".", ",")}% do total`) : "–"}
                {" · "}mínimo {clinic?.settings.minDownPaymentMode === "fixed" ? brl(sim?.minDownPayment ?? 0) : `${clinic?.settings.minDownPaymentPct ?? 0}% (${brl(sim?.minDownPayment ?? 0)})`}
              </p>
            </div>
          </Card>

          <Button variant="primary" size="lg" className="mt-4 w-full max-lg:hidden" disabled={saving || !patient || itemCount === 0} onClick={generate}>
            {saving ? "Gerando proposta…" : "Gerar proposta"}
          </Button>
          <p className="mt-2 text-center text-xs text-mute">A proposta nasce "Em planejamento" e abre para edição.</p>
        </aside>
      </div>

      {/* Celular: total e botão de gerar sempre à mão */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-mute">Total do plano</div>
          <div className="num truncate text-lg font-semibold leading-tight">{brl(total)}</div>
        </div>
        <Button variant="primary" disabled={saving || !patient || itemCount === 0} onClick={generate}>
          {saving ? "Gerando…" : "Gerar proposta"}
        </Button>
      </div>

      {toothFor && toothItem && (
        <ToothPicker
          open
          title={`Dentes — ${procById.get(toothItem.procedureId)?.name ?? "procedimento"}`}
          initialTeeth={parseTeeth(toothItem.toothRegion)}
          initialNote={regionNote(toothItem.toothRegion)}
          onClose={() => setToothFor(null)}
          onConfirm={({ toothRegion, teeth, syncQuantity }) => {
            updateItem(toothFor.phaseKey, toothFor.itemKey, { toothRegion, ...(syncQuantity && teeth.length > 0 ? { quantity: teeth.length } : {}) });
            setToothFor(null);
          }}
        />
      )}
    </div>
  );
}

function ProcedurePicker({ procedures, onPick, onClose }: { procedures: Procedure[]; onPick: (p: Procedure) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "">("");
  const list = procedures.filter((p) => (!cat || p.category === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.code.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="mt-3 rounded-lg border border-brand/40 bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input autoFocus placeholder="Buscar procedimento…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 flex-1 min-w-48" onKeyDown={(e) => e.key === "Escape" && onClose()} />
        {(["", "clinico", "funcional", "estetico"] as const).map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cx("rounded-full border px-3 py-1 text-xs", cat === c ? "border-ink bg-ink text-white" : "border-line-2 bg-card text-ink-2")}>
            {c === "" ? "Todos" : CATEGORY_LABEL[c]}
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
      <div className="mt-2 max-h-72 overflow-y-auto rounded-md bg-card">
        {CATEGORIES.map((c) => {
          const group = list.filter((p) => p.category === c);
          if (!group.length) return null;
          return (
            <section key={c}>
              <h3 className="sticky top-0 flex items-center gap-2 border-b border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-2">
                <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
                {CATEGORY_LABEL[c]} <span className="font-normal text-mute">{group.length}</span>
              </h3>
              <ul className="divide-y divide-line">
                {group.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => onPick(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand-soft/60">
                      <span className="flex items-center gap-2">
                        {p.name}
                        <span className="text-xs text-mute">{p.code}</span>
                        {!p.categoryConfirmed && <span className="text-xs text-amber">tipo a confirmar</span>}
                      </span>
                      <span className="num text-ink-2">{brl(p.basePrice)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {list.length === 0 && <div className="px-3 py-4 text-center text-xs text-mute">Nenhum procedimento encontrado.</div>}
      </div>
    </div>
  );
}
