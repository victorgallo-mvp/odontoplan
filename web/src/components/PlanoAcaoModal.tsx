import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { brl } from "../lib/format";
import { STAGE_LABEL, type Proposal } from "../lib/types";
import { Badge, Modal, Spinner, useToast } from "./ui";
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

  return (
    <Modal open={!!proposalId} onClose={() => onClose(changed.current)} title={p ? `Plano de ação — ${p.patient.name}` : "Plano de ação"} width="max-w-6xl">
      {!p ? (
        <Spinner />
      ) : (
        <>
          <div className="-mt-2 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            <span>{p.title}</span>
            <span className="num font-medium text-ink">{brl(p.total)}</span>
            <Badge tone={p.stage === "aceita" ? "green" : p.stage === "perdida" ? "rose" : "brand"}>{STAGE_LABEL[p.stage]}</Badge>
            <span>{p.dentist.name}</span>
            <Link to={`/propostas/${p.id}`} className="ml-auto font-medium text-brand hover:underline">
              Abrir proposta completa →
            </Link>
          </div>
          <div className="-mx-2 max-h-[72vh] overflow-y-auto px-2 pb-1">
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
