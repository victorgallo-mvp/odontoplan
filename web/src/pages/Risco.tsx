import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { brl, brl0, relativeDays } from "../lib/format";
import type { RiskRow } from "../lib/types";
import { Badge, Button, Input, Modal, ScoreBar, Select, Spinner, cx, useToast } from "../components/ui";

export default function Risco() {
  const toast = useToast();
  const [rows, setRows] = useState<RiskRow[] | null>(null);
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [min, setMin] = useState(50);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<RiskRow | null>(null);
  const [message, setMessage] = useState("");
  const [source, setSource] = useState<"ai" | "fallback" | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api
      .get<{ weights: Record<string, number>; rows: RiskRow[] }>("/risk")
      .then((r) => {
        setRows(r.rows);
        setWeights(r.weights);
      })
      .catch((e) => toast(e.message, "error"));
  }, [toast]);

  const visible = useMemo(() => (rows ?? []).filter((r) => r.score >= min && (!q || r.patient.name.toLowerCase().includes(q.toLowerCase()))), [rows, min, q]);
  const totalStalled = visible.reduce((s, r) => s + r.stalledValue, 0);

  async function openMessage(r: RiskRow) {
    setTarget(r);
    setMessage("");
    setSource(null);
    setGenerating(true);
    try {
      const res = await api.post<{ message: string; source: "ai" | "fallback" }>(`/risk/${r.patient.id}/message`);
      setMessage(res.message);
      setSource(res.source);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setGenerating(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(message);
    toast("Mensagem copiada. Cole no WhatsApp do paciente.");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pacientes em risco</h1>
          <p className="mt-1 text-sm text-ink-2">
            Score 0–100 por regras: tempo sem consulta{weights ? ` (${weights.monthsAway})` : ""}, tratamento aprovado parado{weights ? ` (${weights.pendingTreatment})` : ""}, revisão vencida{weights ? ` (${weights.recallOverdue})` : ""} e faltas{weights ? ` (${weights.noShow})` : ""}.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <Input placeholder="Buscar paciente…" value={q} onChange={(e) => setQ(e.target.value)} className="w-52 max-sm:flex-1" />
          <Select value={min} onChange={(e) => setMin(Number(e.target.value))} className="w-44 max-sm:flex-1">
            <option value={70}>Score ≥ 70 (crítico)</option>
            <option value={50}>Score ≥ 50</option>
            <option value={30}>Score ≥ 30</option>
            <option value={0}>Todos</option>
          </Select>
        </div>
      </header>

      {!rows ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
            <span>
              <strong className="num text-ink">{visible.length}</strong> pacientes na lista
            </span>
            <span>
              <strong className="num text-ink">{brl0(totalStalled)}</strong> em tratamentos aprovados parados ou propostas em aberto
            </span>
          </div>
          <div className="card overflow-hidden">
            <table className="scroll-x w-full text-sm">
              <thead className="bg-paper text-left text-xs text-ink-2">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Score</th>
                  <th className="px-4 py-2.5 font-medium">Paciente</th>
                  <th className="px-4 py-2.5 font-medium">Motivos</th>
                  <th className="px-4 py-2.5 text-right font-medium">Valor parado</th>
                  <th className="px-4 py-2.5 font-medium">Última consulta</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((r) => (
                  <tr key={r.patient.id} className="align-top hover:bg-paper/60">
                    <td className="px-4 py-3">
                      <ScoreBar score={r.score} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.patient.name}</div>
                      <div className="text-xs text-mute">{[r.patient.age !== null ? `${r.patient.age} anos` : null, r.patient.city, r.patient.phone].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="max-w-md px-4 py-3">
                      <ul className="space-y-0.5 text-[13px] text-ink-2">
                        {r.reasons.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                      {r.openProposals.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.openProposals.map((o) => (
                            <Link key={o.id} to={`/propostas/${o.id}`}>
                              <Badge tone="brand">proposta em aberto · {brl0(o.total)}</Badge>
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="num px-4 py-3 text-right font-medium">{r.stalledValue ? brl(r.stalledValue) : <span className="text-mute">—</span>}</td>
                    <td className="px-4 py-3 text-ink-2">
                      {relativeDays(r.lastVisitAt)}
                      {r.dentistName && <div className="text-xs text-mute">{r.dentistName}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" onClick={() => void openMessage(r)}>
                        Gerar mensagem
                      </Button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-mute">
                      Nenhum paciente com esse filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={!!target} onClose={() => setTarget(null)} title="Mensagem de reativação" width="max-w-xl">
        {target && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <span>
                Para <strong className="text-ink">{target.patient.name}</strong>
                {target.patient.phone ? ` · ${target.patient.phone}` : ""}
              </span>
              {source && <Badge tone={source === "ai" ? "green" : "neutral"}>{source === "ai" ? "redigida pela IA" : "modelo padrão (IA desligada)"}</Badge>}
            </div>
            <textarea
              value={generating ? "Escrevendo…" : message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={generating}
              rows={9}
              className={cx("w-full resize-y rounded-lg border border-line-2 bg-card p-3 text-sm leading-relaxed focus:border-brand", generating && "text-mute")}
            />
            <p className="mt-2 text-xs text-mute">Rascunho para você revisar. Nada é enviado automaticamente — copie e cole no WhatsApp. A IA recebe só o primeiro nome e o contexto do tratamento.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => void openMessage(target)} disabled={generating}>
                Gerar outra
              </Button>
              <Button variant="primary" onClick={copy} disabled={generating || !message}>
                Copiar mensagem
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
