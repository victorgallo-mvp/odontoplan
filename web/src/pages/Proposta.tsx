import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { brl, dateLong, phaseTitle } from "../lib/format";
import { toothFillsOf } from "../lib/teeth";
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL, STAGES, STAGE_LABEL, type Category, type Proposal, type Scenario, type Stage } from "../lib/types";
import { Badge, Button, Modal, Select, Spinner, cx, useToast } from "../components/ui";
import { Odontograma, OdontogramaLegend } from "../components/Odontograma";
import { PlanoAcao } from "../components/PlanoAcao";

function Editable({ value, onChange, as = "p", className, placeholder, version }: { value: string | null; onChange: (v: string) => void; as?: "p" | "h1" | "span"; className?: string; placeholder?: string; version: number }) {
  const Tag = as;
  return (
    <Tag
      key={version}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder ?? "Clique para escrever…"}
      className={cx("editable", className)}
      onBlur={(e) => onChange(e.currentTarget.innerText.trim())}
    >
      {value ?? ""}
    </Tag>
  );
}

export default function Proposta() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [p, setP] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<{ title: string; summaryText: string | null; benefitsText: string | null; observations: string | null; phases: Record<string, string | null> }>({ title: "", summaryText: null, benefitsText: null, observations: null, phases: {} });
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);
  const [source, setSource] = useState<"ai" | "fallback" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState<"doc" | "acao">("doc");

  const load = useCallback(async () => {
    const data = await api.get<Proposal>(`/proposals/${id}`);
    setP(data);
    setDraft({ title: data.title, summaryText: data.summaryText, benefitsText: data.benefitsText, observations: data.observations, phases: Object.fromEntries(data.phases.map((ph) => [ph.id, ph.description])) });
    setVersion((v) => v + 1);
    setDirty(false);
  }, [id]);

  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  async function save() {
    if (!p) return;
    setBusy("save");
    try {
      await api.patch(`/proposals/${p.id}`, { ...draft, phases: Object.entries(draft.phases).map(([pid, description]) => ({ id: pid, description })) });
      await load();
      toast("Proposta salva");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    if (!p) return;
    setBusy("ai");
    try {
      const r = await api.post<{ texts: { summary: string; benefits: string; phases: { id: string; description: string }[] }; source: "ai" | "fallback" }>(`/proposals/${p.id}/texts`);
      setDraft((d) => ({ ...d, summaryText: r.texts.summary, benefitsText: r.texts.benefits, phases: Object.fromEntries(r.texts.phases.map((x) => [x.id, x.description])) }));
      setVersion((v) => v + 1);
      setDirty(true);
      setSource(r.source);
      toast(r.source === "ai" ? "Rascunho gerado pela IA. Revise e salve." : "IA desligada: textos padrão aplicados. Revise e salve.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function moveStage(stage: Stage) {
    if (!p) return;
    const lostReason = stage === "perdida" ? window.prompt("Motivo da perda:", "Vai pensar / sem retorno") ?? undefined : undefined;
    if (stage === "perdida" && lostReason === undefined) return;
    await api.patch(`/proposals/${p.id}/stage`, { stage, lostReason });
    await load();
    toast(`Movida para ${STAGE_LABEL[stage]}`);
  }

  async function remove() {
    if (!p) return;
    setBusy("save");
    try {
      await api.del(`/proposals/${p.id}`);
      setDirty(false);
      toast("Orçamento excluído");
      navigate("/propostas");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao excluir", "error");
      setBusy(null);
    }
  }

  async function chooseScenario(s: Scenario) {
    if (!p) return;
    await api.patch(`/proposals/${p.id}`, { paymentMethod: s.method, installments: s.installments, downPayment: s.downPayment });
    await load();
    toast(`Condição sugerida: ${s.label}`);
  }

  if (!p) return <Spinner />;
  const brand = p.clinic.primaryColor;
  const phaseTotal = (phId: string) => p.phases.find((x) => x.id === phId)!.items.reduce((s, i) => s + i.total, 0);
  const chosenMethod = p.paymentMethod;
  const items = p.phases.flatMap((ph) => ph.items);
  const byCategory: Record<Category, number> = { clinico: 0, funcional: 0, estetico: 0 };
  for (const it of items) byCategory[it.procedure.category] += it.total;
  const usedCategories = CATEGORIES.filter((c) => byCategory[c] > 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="no-print sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 px-6 py-3">
          <Link to="/propostas" className="text-sm text-ink-2 hover:text-ink">
            ← Propostas
          </Link>
          <span className="text-line-2">|</span>
          <span className="text-sm font-medium">{p.patient.name}</span>
          <Badge tone={p.stage === "aceita" ? "green" : p.stage === "perdida" ? "rose" : "brand"}>{STAGE_LABEL[p.stage]}</Badge>
          <Select value={p.stage} onChange={(e) => void moveStage(e.target.value as Stage)} className="h-9 w-64 text-[13px]">
            {STAGES.map((s) => (
              <option key={s} value={s}>
                Mover para: {STAGE_LABEL[s]}
              </option>
            ))}
          </Select>
          <div className="flex overflow-hidden rounded-lg border border-line-2 text-[13px]" role="tablist" aria-label="Visão da proposta">
            {(["doc", "acao"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx("px-3 py-1.5 font-medium", view === v ? "bg-ink text-white" : "bg-card text-ink-2 hover:bg-paper")}>
                {v === "doc" ? "Proposta" : `Plano de ação${p.actionPlan.pending.count && p.actionPlan.accepted.count ? " •" : ""}`}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {source && <Badge tone={source === "ai" ? "green" : "neutral"}>{source === "ai" ? "rascunho da IA" : "texto padrão"} — revise antes de apresentar</Badge>}
            <Button size="sm" onClick={regenerate} disabled={busy !== null}>
              {busy === "ai" ? "Gerando…" : "Regenerar textos com IA"}
            </Button>
            <Button size="sm" variant={dirty ? "primary" : "secondary"} onClick={save} disabled={busy !== null || !dirty}>
              {busy === "save" ? "Salvando…" : dirty ? "Salvar alterações" : "Salvo"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => window.print()}>
              Imprimir / Salvar PDF
            </Button>
            <Button size="sm" variant="ghost" className="text-rose" onClick={() => setConfirmDelete(true)} disabled={busy !== null} title="Excluir orçamento">
              Excluir
            </Button>
          </div>
        </div>
        <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Excluir orçamento?">
          <p className="text-sm text-ink-2">
            O orçamento de <strong>{p.patient.name}</strong> ({p.title}) será removido do OdontoPlan, junto com fases, itens e histórico. Não dá para desfazer.
          </p>
          {p.externalId && (
            <p className="mt-2 text-sm text-ink-2">
              Ele veio do Clinicorp, onde continua existindo: a API deles não permite excluir. Aqui ele não voltará nas próximas sincronizações.
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void remove()} disabled={busy !== null}>
              Excluir
            </Button>
          </div>
        </Modal>
        {view === "doc" && <p className="mx-auto max-w-[1200px] px-6 pb-2 text-xs text-mute">Todos os textos são editáveis: clique em um parágrafo para ajustar. O que você vê é o que sai no PDF.</p>}
      </div>

      {view === "acao" && (
        <div className="no-print">
          <PlanoAcao p={p} onUpdated={setP} />
        </div>
      )}

      {/* O documento fica montado (só oculto) para não perder edições e para a impressão sair sempre dele. */}
      <div className={cx("py-8 print:block print:py-0", view !== "doc" && "hidden")}>
        <article className="doc">
          {/* ── Capa ── */}
          <div className="doc-page flex min-h-[297mm] flex-col print:min-h-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {p.clinic.logoUrl ? (
                  <img src={p.clinic.logoUrl} alt="" className="h-12" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg text-white" style={{ background: brand }}>
                    <span className="font-serif text-2xl font-semibold">{p.clinic.name.replace(/^Cl[ií]nica\s+/i, "").charAt(0)}</span>
                  </div>
                )}
                <div>
                  <div className="font-semibold">{p.clinic.name}</div>
                  <div className="text-xs text-ink-2">
                    {p.clinic.city}/{p.clinic.state}
                    {p.clinic.phone ? ` · ${p.clinic.phone}` : ""}
                  </div>
                </div>
              </div>
              <div className="text-right text-xs text-ink-2">
                <div>Proposta nº {p.id.slice(-6).toUpperCase()}</div>
                <div>{dateLong(p.createdAt)}</div>
              </div>
            </div>

            <div className="mt-16">
              <div className="text-sm text-ink-2">Proposta de tratamento</div>
              <Editable as="h1" version={version} value={draft.title} onChange={(v) => set("title", v || p.title)} className="mt-2 text-[34px] font-semibold leading-[1.15]" />
              <div className="mt-6 h-1 w-20 rounded-full" style={{ background: brand }} />
              <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                <div>
                  <dt className="text-xs text-ink-2">Preparada para</dt>
                  <dd className="mt-0.5 text-base font-medium">{p.patient.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-2">Responsável técnico</dt>
                  <dd className="mt-0.5 text-base font-medium">{p.dentist.name}</dd>
                  <dd className="text-xs text-ink-2">{[p.dentist.cro, p.dentist.specialty].filter(Boolean).join(" · ")}</dd>
                </div>
              </dl>
            </div>

            <section className="mt-12">
              <h2 className="text-xl font-semibold">Resumo do plano</h2>
              <Editable version={version} value={draft.summaryText} onChange={(v) => set("summaryText", v)} className="mt-3 text-[14px] leading-relaxed text-ink" placeholder="Resumo do plano em linguagem simples…" />
            </section>

            <section className="mt-10">
              <h2 className="text-xl font-semibold">Etapas do tratamento</h2>
              <ol className="mt-4 space-y-2">
                {p.phases.map((ph) => (
                  <li key={ph.id} className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: brand }}>
                        {ph.order}
                      </span>
                      <div>
                        <div className="text-sm font-medium">{ph.name}</div>
                        <div className="text-xs text-ink-2">
                          {ph.items.length} {ph.items.length === 1 ? "procedimento" : "procedimentos"}
                        </div>
                      </div>
                    </div>
                    <div className="num text-sm font-medium">{brl(phaseTotal(ph.id))}</div>
                  </li>
                ))}
              </ol>
            </section>

            <div className="mt-auto pt-10 text-xs text-ink-2">
              Investimento total <strong className="num text-ink">{brl(p.total)}</strong> · condições de pagamento na página seguinte · válida até {dateLong(p.validUntil)}
            </div>
          </div>

          {/* ── Detalhamento ── */}
          <div className="doc-page doc-break">
            <h2 className="text-xl font-semibold">O que será feito em cada etapa</h2>
            <div className="mt-6 space-y-8">
              {p.phases.map((ph) => (
                <section key={ph.id} className="avoid-break">
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: brand }} />
                    {phaseTitle(ph.order, ph.name)}
                  </h3>
                  <Editable version={version} value={draft.phases[ph.id] ?? null} onChange={(v) => set("phases", { ...draft.phases, [ph.id]: v })} className="mt-2 text-[13.5px] leading-relaxed text-ink-2" placeholder="Explique esta etapa para o paciente…" />
                  <table className="mt-3">
                    <thead>
                      <tr>
                        <th>Procedimento</th>
                        <th>Tipo</th>
                        <th>Dente / região</th>
                        <th className="num">Qtd</th>
                        <th className="num">Valor unitário</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ph.items.map((it) => (
                        <tr key={it.id}>
                          <td>
                            <div className="font-medium">{it.description}</div>
                            {it.procedure.description && <div className="mt-0.5 text-[11.5px] text-ink-2">{it.procedure.description}</div>}
                          </td>
                          <td className="whitespace-nowrap">
                            <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[it.procedure.category] }} />
                            {CATEGORY_LABEL[it.procedure.category]}
                          </td>
                          <td>{it.toothRegion ?? "—"}</td>
                          <td className="num">{it.quantity}</td>
                          <td className="num">{brl(it.unitPrice)}</td>
                          <td className="num font-medium">{brl(it.total)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={5} className="text-right text-xs text-ink-2">
                          Subtotal da fase {ph.order}
                        </td>
                        <td className="num font-semibold">{brl(phaseTotal(ph.id))}</td>
                      </tr>
                    </tbody>
                  </table>
                  {(() => {
                    const fills = toothFillsOf(ph.items, (i) => i.toothRegion, (i) => CATEGORY_COLOR[i.procedure.category]);
                    const teeth = Object.keys(fills);
                    if (teeth.length === 0) return null;
                    const used = CATEGORIES.filter((c) => ph.items.some((i) => i.procedure.category === c));
                    return (
                      <figure className="avoid-break mt-4 rounded-lg border border-line px-4 py-3">
                        <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-2">
                          <span>Dentes tratados nesta etapa</span>
                          <OdontogramaLegend items={used.map((c) => ({ color: CATEGORY_COLOR[c], label: CATEGORY_LABEL[c] }))} />
                        </figcaption>
                        <Odontograma className="mx-auto max-w-[125mm]" fills={fills} showDeciduous={teeth.some((t) => Number(t) >= 51)} label={`Dentes tratados na fase ${ph.order}: ${teeth.join(", ")}`} />
                      </figure>
                    );
                  })()}
                </section>
              ))}
            </div>
          </div>

          {/* ── Investimento e condições ── */}
          <div className="doc-page doc-break">
            <h2 className="text-xl font-semibold">Investimento</h2>
            <table className="mt-4 avoid-break">
              <tbody>
                {p.phases.map((ph) => (
                  <tr key={ph.id}>
                    <td>
                      {phaseTitle(ph.order, ph.name)}
                    </td>
                    <td className="num">{brl(phaseTotal(ph.id))}</td>
                  </tr>
                ))}
                {p.discount > 0 && (
                  <tr>
                    <td>Desconto</td>
                    <td className="num">− {brl(p.discount)}</td>
                  </tr>
                )}
                <tr>
                  <td className="text-base font-semibold">Total do tratamento</td>
                  <td className="num text-base font-semibold">{brl(p.total)}</td>
                </tr>
              </tbody>
            </table>

            {usedCategories.length > 1 && (
              <div className="avoid-break mt-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${usedCategories.length}, minmax(0, 1fr))` }}>
                {usedCategories.map((c) => (
                  <div key={c} className="rounded-lg border border-line px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-ink-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
                      {CATEGORY_LABEL[c]}
                    </div>
                    <div className="num mt-0.5 text-sm font-semibold">{brl(byCategory[c])}</div>
                  </div>
                ))}
              </div>
            )}

            <h2 className="mt-10 text-xl font-semibold">Condições de pagamento</h2>
            <p className="mt-1 text-xs text-ink-2">Você escolhe a forma que couber melhor no seu orçamento. Valores já incluem eventuais taxas.</p>
            <div className="mt-4 grid grid-cols-3 gap-3 avoid-break">
              {p.scenarios.map((s) => {
                const chosen = s.method === chosenMethod;
                return (
                  <div key={s.method} className={cx("rounded-xl border p-4", chosen ? "border-2" : "border-line")} style={chosen ? { borderColor: brand } : undefined}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold">{s.label}</div>
                      {chosen && (
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ background: brand }}>
                          sugerida
                        </span>
                      )}
                    </div>
                    <div className="num mt-3 text-[22px] font-semibold leading-none">{s.installments > 1 ? `${s.installments}× ${brl(s.installmentValue)}` : brl(s.total)}</div>
                    <div className="mt-2 text-xs text-ink-2">
                      {s.method === "avista" && `${Math.abs(s.ratePct)}% de desconto · total ${brl(s.total)}`}
                      {s.method === "cartao" && `no cartão de crédito · total ${brl(s.total)}`}
                      {s.method === "boleto" && `entrada de ${brl(s.downPayment)} + ${s.installments} parcelas sem juros · total ${brl(s.total)}`}
                    </div>
                    {!chosen && (
                      <button onClick={() => void chooseScenario(s)} className="no-print mt-3 text-xs font-medium text-brand hover:underline">
                        Marcar como sugerida
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <section className="mt-10 avoid-break">
              <h2 className="text-xl font-semibold">Por que vale a pena</h2>
              <Editable version={version} value={draft.benefitsText} onChange={(v) => set("benefitsText", v)} className="mt-3 text-[14px] leading-relaxed" placeholder="Benefícios de concluir o tratamento…" />
            </section>

            <section className="mt-8 avoid-break">
              <h2 className="text-base font-semibold">Observações</h2>
              <Editable version={version} value={draft.observations} onChange={(v) => set("observations", v)} className="mt-2 min-h-10 text-[13px] leading-relaxed text-ink-2" placeholder="Espaço para combinados, alergias informadas, prioridades do paciente…" />
            </section>

            <section className="mt-10 avoid-break text-[12.5px] text-ink-2">
              <p>
                Esta proposta é válida até <strong className="text-ink">{dateLong(p.validUntil)}</strong>. Os valores podem ser revistos após essa data ou caso o exame clínico indique necessidade de procedimentos adicionais, sempre com sua aprovação prévia.
              </p>
              <div className="mt-14 grid grid-cols-2 gap-12">
                <div className="border-t border-ink-2 pt-2 text-center text-xs">
                  {p.patient.name}
                  <br />
                  <span className="text-mute">Paciente ou responsável</span>
                </div>
                <div className="border-t border-ink-2 pt-2 text-center text-xs">
                  {p.dentist.name}
                  <br />
                  <span className="text-mute">{p.dentist.cro ?? "Cirurgião-dentista"}</span>
                </div>
              </div>
            </section>

            <footer className="mt-12 flex items-center justify-between border-t border-line pt-3 text-[11px] text-mute">
              <span>
                {p.clinic.name} · {p.clinic.city}/{p.clinic.state}
              </span>
              <span>{[p.clinic.phone, p.clinic.email].filter(Boolean).join(" · ")}</span>
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
}
