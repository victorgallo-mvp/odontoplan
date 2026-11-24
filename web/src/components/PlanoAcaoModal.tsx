import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { brl } from "../lib/format";
import { LOST_REASONS, STAGES, STAGE_LABEL, type Proposal, type Stage } from "../lib/types";
import { Modal, Select, Spinner, useToast } from "./ui";
import { PlanoAcao } from "./PlanoAcao";

/**
 * Plano de ação em modal (Kanban e Dashboard): aceitar / recusar / confirmar
 * pagamento por item sem sair da tela. `onClose(changed)` avisa se algo mudou
 * para a tela de origem recarregar.
 */
export function PlanoAcaoModal({ proposalId, onClose }: { proposalId: string | null; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [p, setP] = useState<Proposal | null>(null);
  const changed = useRef(false);

  useEffect(() => {
    setP(null);
    changed.current = false;
    if (!proposalId) return;
    let alive = true;
    api
      .get<Proposal>(`/proposals/${proposalId}`)
      .then((data) => alive && setP(data))
      .catch((e) => {
        toast(e instanceof Error ? e.message : "Falha ao abrir a proposta", "error");
        onClose(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  // Mesmo efeito de arrastar o cartão no Kanban (útil no celular, onde arrastar é difícil)
  async function changeStage(stage: Stage) {
    if (!p || stage === p.stage) return;
    let lostReason: string | undefined;
    if (stage === "perdida") {
      lostReason = window.prompt("Motivo da perda:", LOST_REASONS[1]) ?? undefined;
      if (lostReason === undefined) return;
    }
    try {
      await api.patch(`/proposals/${p.id}/stage`, { stage, lostReason });
      changed.current = true;
      setP(await api.get<Proposal>(`/proposals/${p.id}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao mover", "error");
    }
  }

  return (
    <Modal open={!!proposalId} onClose={() => onClose(changed.current)} title={p ? `Plano de ação — ${p.patient.name}` : "Plano de ação"} width="max-w-6xl">
      {!p ? (
        <Spinner />
      ) : (
        <>
          <div className="-mt-2 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            <span>{p.title}</span>
            <span className="num font-medium text-ink">{brl(p.total)}</span>
            <span>{p.dentist.name}</span>
            <Select value={p.stage} onChange={(e) => void changeStage(e.target.value as Stage)} className="h-9 w-56 text-[13px] max-sm:w-full" aria-label="Etapa da proposta">
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  Etapa: {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
            <Link to={`/propostas/${p.id}`} className="font-medium text-brand hover:underline sm:ml-auto">
              Abrir proposta completa →
            </Link>
          </div>
          <div className="sm:-mx-2 sm:max-h-[72vh] sm:overflow-y-auto sm:px-2 sm:pb-1">
            <PlanoAcao
              embedded
              p={p}
              onUpdated={(next) => {
                changed.current = true;
                setP(next);
              }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
