import { useState } from "react";
import { api } from "../lib/api";
import { brl, dateBR, phaseTitle } from "../lib/format";
import { CATEGORY_COLOR, CATEGORY_LABEL, DECISION_LABEL, LOST_REASONS, STAGE_LABEL, type ItemDecision, type Proposal, type ProposalItem } from "../lib/types";
import { Badge, Button, Field, Input, Modal, Select, cx, useToast } from "./ui";

type Patch = { id: string; decision?: ItemDecision; declineReason?: string | null; paid?: boolean };
const OTHER = "Outro motivo…";

const DECISION_STYLE: Record<ItemDecision, string> = {
  pendente: "bg-ink text-white",
  aceito: "bg-green text-white",
  recusado: "bg-rose text-white",
};

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "green" | "brand" | "amber" | "rose" }) {
  const color = tone === "green" ? "text-green" : tone === "rose" ? "text-rose" : tone === "amber" ? "text-amber" : tone === "brand" ? "text-brand-2" : "text-ink";
  return (
    <div className="card p-4">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className={cx("num mt-1 text-2xl font-semibold leading-tight", color)}>{value}</div>
      <div className="mt-0.5 text-xs text-mute">{sub}</div>
    </div>
  );
}

const nItems = (n: number) => `${n} ${n === 1 ? "item" : "itens"}`;

/**
 * Plano de ação: o paciente pode fechar só parte da proposta. Aqui cada item é
 * marcado como aceito, recusado (com motivo) ou pendente, e os aceitos podem
 * ter o pagamento confirmado.
 */
export function PlanoAcao({ p, onUpdated, embedded = false }: { p: Proposal; onUpdated: (next: Proposal) => void; embedded?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<{ items: ProposalItem[]; label: string } | null>(null);
  const [reason, setReason] = useState(LOST_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const ap = p.actionPlan;
  const allItems = p.phases.flatMap((ph) => ph.items);

  async function send(patches: Patch[]) {
    if (!patches.length || busy) return;
    setBusy(true);
    try {
      const next = await api.patch<Proposal>(`/proposals/${p.id}/items`, { items: patches });
      onUpdated({ ...next, clinic: p.clinic });
      if (next.stage !== p.stage) toast(next.stage === "negociacao" ? "Item reaberto: proposta voltou para “Em negociação”" : `Todos os itens decididos: proposta em “${STAGE_LABEL[next.stage]}”`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao salvar", "error");
    } finally {
      setBusy(false);
    }
  }

  function decide(items: ProposalItem[], decision: ItemDecision, label: string) {
    const targets = items.filter((i) => i.decision !== decision);
    if (!targets.length) return;
    if (decision === "recusado") {
      setDeclining({ items: targets, label });
      return;
    }
    void send(targets.map((i) => ({ id: i.id, decision })));
  }

  function confirmDecline() {
    if (!declining) return;
    const text = reason === OTHER ? otherReason.trim() : reason;
    void send(declining.items.map((i) => ({ id: i.id, decision: "recusado" as const, declineReason: text || "Não informado" })));
    setDeclining(null);
    setOtherReason("");
  }

  const clinicorpPaid = p.payments.filter((x) => x.status === "pago").reduce((s, x) => s + x.amount, 0);
  const clinicorpTotal = p.payments.reduce((s, x) => s + x.amount, 0);
  const clinicorpLate = p.payments.filter((x) => x.status === "atrasado").reduce((s, x) => s + x.amount, 0);

  return (
    <div className={embedded ? "" : "mx-auto max-w-[1100px] px-4 py-5 sm:px-6 sm:py-8"}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          {!embedded && <h1 className="text-2xl font-semibold">Plano de ação</h1>}
          <p className={cx("max-w-2xl text-sm text-ink-2", !embedded && "mt-1")}>
            Marque o que {p.patient.name.split(" ")[0]} decidiu em cada item: o que foi aceito, o que foi recusado (e por quê) e o que já foi pago. No Kanban, a parte aceita aparece em “Aceita”, a recusada em “Perdida” e o que falta decidir continua na etapa atual.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => decide(allItems.filter((i) => i.decision === "pendente"), "aceito", "")} disabled={busy || ap.pending.count === 0}>
            Aceitar pendentes
          </Button>
          <Button size="sm" onClick={() => decide(allItems.filter((i) => i.decision === "pendente"), "recusado", `${nItems(ap.pending.count)} pendentes`)} disabled={busy || ap.pending.count === 0}>
            Recusar pendentes
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Aceito" value={brl(ap.accepted.value)} sub={`${nItems(ap.accepted.count)} de ${allItems.length}`} tone="green" />
        <Tile label="Pago" value={brl(ap.paid.value)} sub={nItems(ap.paid.count)} tone="brand" />
        <Tile label="Aceito a receber" value={brl(ap.toReceive.value)} sub={nItems(ap.toReceive.count)} tone={ap.toReceive.count ? "amber" : undefined} />
        <Tile label="Pendente de decisão" value={brl(ap.pending.value)} sub={nItems(ap.pending.count)} />
        <Tile label="Recusado" value={brl(ap.declined.value)} sub={nItems(ap.declined.count)} tone={ap.declined.count ? "rose" : undefined} />
      </div>
      {p.discount > 0 && (
        <p className="mt-2 text-xs text-mute">
          Os totais acima já distribuem o desconto adicional de {brl(p.discount)} proporcionalmente entre os itens; nas linhas abaixo aparece o valor de cada item sem esse desconto.
        </p>
      )}

      <div className="mt-6 space-y-5">
        {p.phases.map((ph) => {
          const accepted = ph.items.filter((i) => i.decision === "aceito");
          const unpaid = accepted.filter((i) => !i.paidAt);
          return (
            <section key={ph.id} className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                <div>
                  <h2 className="text-[15px] font-semibold">
                    {phaseTitle(ph.order, ph.name)}
                  </h2>
                  <div className="num text-xs text-mute">
                    {nItems(ph.items.length)} · {brl(ph.items.reduce((s, i) => s + i.total, 0))} · {accepted.length} aceito(s)
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" disabled={busy || accepted.length === ph.items.length} onClick={() => decide(ph.items, "aceito", "")}>
                    Aceitar fase
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || ph.items.every((i) => i.decision === "recusado")} onClick={() => decide(ph.items, "recusado", phaseTitle(ph.order, ph.name))}>
                    Recusar fase
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || unpaid.length === 0} onClick={() => void send(unpaid.map((i) => ({ id: i.id, paid: true })))}>
                    Marcar aceitos como pagos
                  </Button>
                </div>
              </header>
              <div className="overflow-x-auto">
                <table className="stack w-full text-sm md:min-w-[760px]">
                  <thead>
                    <tr className="text-left text-xs text-mute">
                      <th className="px-5 py-2 font-medium">Procedimento</th>
                      <th className="px-3 py-2 font-medium">Dente / região</th>
                      <th className="px-3 py-2 text-right font-medium">Valor</th>
                      <th className="px-3 py-2 font-medium">Decisão</th>
                      <th className="px-5 py-2 font-medium">Pagamento / motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {ph.items.map((it) => (
                      <tr key={it.id} className={cx("max-md:px-4", it.decision === "recusado" && "bg-rose-soft/30")}>
                        <td className="full px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[it.procedure.category] }} title={CATEGORY_LABEL[it.procedure.category]} />
                            <span className={cx("font-medium", it.decision === "recusado" && "text-ink-2 line-through")}>{it.description}</span>
                          </div>
                          <div className="pl-4 text-xs text-mute">
                            {CATEGORY_LABEL[it.procedure.category]}
                            {it.quantity > 1 ? ` · ${it.quantity} × ${brl(it.unitPrice)}` : ""}
                          </div>
                        </td>
                        <td className="num px-3 py-2.5 text-ink-2" data-label="Dente / região">
                          {it.toothRegion ?? "–"}
                        </td>
                        <td className="num px-3 py-2.5 text-right font-medium max-md:text-left" data-label="Valor">
                          {brl(it.total)}
                        </td>
                        <td className="full px-3 py-2.5">
                          <div className="inline-flex overflow-hidden rounded-lg border border-line-2 max-md:flex" role="group" aria-label={`Decisão para ${it.description}`}>
                            {(["pendente", "aceito", "recusado"] as const).map((d) => (
                              <button
                                key={d}
                                type="button"
                                disabled={busy}
                                aria-pressed={it.decision === d}
                                onClick={() => decide([it], d, it.description)}
                                className={cx("px-2.5 py-1.5 text-xs font-medium transition-colors max-md:flex-1 max-md:py-2.5 max-md:text-sm", it.decision === d ? DECISION_STYLE[d] : "bg-card text-ink-2 hover:bg-paper")}
                              >
                                {DECISION_LABEL[d]}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="full px-5 py-2.5">
                          {it.decision === "aceito" && (
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={!!it.paidAt} disabled={busy} onChange={(e) => void send([{ id: it.id, paid: e.target.checked }])} />
                              {it.paidAt ? <Badge tone="green">Pago em {dateBR(it.paidAt)}</Badge> : <span className="text-ink-2">Confirmar pagamento</span>}
                            </label>
                          )}
                          {it.decision === "recusado" && (
                            <button type="button" className="text-left text-sm text-rose hover:underline" disabled={busy} onClick={() => setDeclining({ items: [it], label: it.description })} title="Alterar motivo">
                              {it.declineReason ?? "Motivo não informado"}
                            </button>
                          )}
                          {it.decision === "pendente" && <span className="text-xs text-mute">aguardando decisão</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      {p.payments.length > 0 && (
        <section className="card mt-6 p-5">
          <h2 className="text-[15px] font-semibold">Recebimentos lançados no Clinicorp</h2>
          <p className="mt-1 text-sm text-ink-2">
            <span className="num font-medium text-ink">{brl(clinicorpPaid)}</span> recebidos de <span className="num">{brl(clinicorpTotal)}</span> lançados
            {clinicorpLate > 0 && (
              <>
                {" · "}
                <span className="num text-rose">{brl(clinicorpLate)} em atraso</span>
              </>
            )}
            . O Clinicorp lança por orçamento, não por item: use como conferência ao confirmar os pagamentos acima.
          </p>
          <table className="scroll-x mt-3 w-full text-sm">
            <tbody className="divide-y divide-line">
              {p.payments.map((pay) => (
                <tr key={pay.id}>
                  <td className="num py-1.5 text-ink-2">
                    {pay.installmentNumber}/{pay.installmentsTotal}
                  </td>
                  <td className="py-1.5 text-ink-2">{pay.method}</td>
                  <td className="num py-1.5">vence {dateBR(pay.dueDate)}</td>
                  <td className="num py-1.5 text-right font-medium">{brl(pay.amount)}</td>
                  <td className="py-1.5 pl-4 text-right">
                    <Badge tone={pay.status === "pago" ? "green" : pay.status === "atrasado" ? "rose" : "neutral"}>{pay.status === "pago" ? `pago ${dateBR(pay.paidAt)}` : pay.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Modal open={!!declining} onClose={() => setDeclining(null)} title="Motivo da recusa">
        <p className="text-sm text-ink-2">
          {declining?.items.length === 1 ? (
            <>
              Por que <strong>{declining.label}</strong> foi recusado?
            </>
          ) : (
            <>
              Motivo para recusar <strong>{declining?.label || nItems(declining?.items.length ?? 0)}</strong> ({nItems(declining?.items.length ?? 0)}):
            </>
          )}
        </p>
        <Select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-3" aria-label="Motivo da recusa">
          {[...LOST_REASONS, OTHER].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        {reason === OTHER && (
          <Field label="Descreva o motivo" className="mt-3">
            <Input autoFocus value={otherReason} onChange={(e) => setOtherReason(e.target.value)} maxLength={200} />
          </Field>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setDeclining(null)}>Cancelar</Button>
          <Button variant="danger" onClick={confirmDecline}>
            Confirmar recusa
          </Button>
        </div>
      </Modal>
    </div>
  );
}
