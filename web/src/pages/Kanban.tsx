import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { api } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { brl, daysSince } from "../lib/format";
import { LOST_REASONS, STAGES, STAGE_LABEL, type Dentist, type ProposalCard, type Stage } from "../lib/types";
import { Badge, Button, Modal, Select, Spinner, cx, useToast } from "../components/ui";
import { PlanoAcaoModal } from "../components/PlanoAcaoModal";

/**
 * Um cartão do Kanban. Proposta com decisões misturadas é dividida em até três
 * partes: a aceita vai para "Aceita", a recusada para "Perdida" e o que falta
 * decidir fica na etapa atual. Só a parte pendente (ou o cartão inteiro) arrasta.
 */
type Piece = { key: string; card: ProposalCard; part: "inteira" | "aceita" | "recusada" | "pendente"; stage: Stage; value: number; items: number; totalItems: number; draggable: boolean };

function splitCard(c: ProposalCard): Piece[] {
  const ap = c.actionPlan;
  const totalItems = ap ? ap.accepted.count + ap.declined.count + ap.pending.count : 0;
  const mixed = ap ? [ap.accepted.count, ap.declined.count, ap.pending.count].filter((n) => n > 0).length > 1 : false;
  if (!ap || !mixed) return [{ key: c.id, card: c, part: "inteira", stage: c.stage, value: c.total, items: totalItems, totalItems, draggable: true }];
  const open = c.stage === "aceita" || c.stage === "perdida" ? "negociacao" : c.stage;
  const pieces: Piece[] = [];
  if (ap.pending.count) pieces.push({ key: `${c.id}:pendente`, card: c, part: "pendente", stage: open, value: ap.pending.value, items: ap.pending.count, totalItems, draggable: true });
  if (ap.accepted.count) pieces.push({ key: `${c.id}:aceita`, card: c, part: "aceita", stage: "aceita", value: ap.accepted.value, items: ap.accepted.count, totalItems, draggable: false });
  if (ap.declined.count) pieces.push({ key: `${c.id}:recusada`, card: c, part: "recusada", stage: "perdida", value: ap.declined.value, items: ap.declined.count, totalItems, draggable: false });
  return pieces;
}

function CardView({ piece, alertDays, dragging, onDelete, onOpen }: { piece: Piece; alertDays: number; dragging?: boolean; onDelete?: (card: ProposalCard) => void; onOpen?: (card: ProposalCard) => void }) {
  const { card } = piece;
  const days = daysSince(card.stageChangedAt) ?? 0;
  const stale = piece.stage === "apresentada" && days > alertDays;
  const split = piece.part !== "inteira";
  const paid = card.actionPlan?.paid;
  return (
    <div
      className={cx("card select-none p-3 text-sm", piece.draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", dragging && "rotate-1 shadow-xl", stale && "ring-1 ring-amber/60")}
      onClick={() => onOpen?.(card)}
      title="Clique para abrir o plano de ação"
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen?.(card); }} onPointerDown={(e) => e.stopPropagation()} className="text-left font-medium leading-snug hover:underline">
          {card.patient.name}
        </button>
        <span className="flex shrink-0 items-center gap-1">
          <span className="num font-semibold">{brl(piece.value)}</span>
          {onDelete && !split && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(card);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="rounded p-0.5 text-mute hover:bg-rose-soft hover:text-rose"
              aria-label="Excluir orçamento"
              title="Excluir orçamento"
            >
              ✕
            </button>
          )}
        </span>
      </div>
      <div className="mt-0.5 truncate text-xs text-ink-2">{card.title}</div>
      {split && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Badge tone={piece.part === "aceita" ? "green" : piece.part === "recusada" ? "rose" : "neutral"}>
            {piece.part === "aceita" ? "parte aceita" : piece.part === "recusada" ? "parte recusada" : "falta decidir"} · {piece.items} de {piece.totalItems} itens
          </Badge>
          <span className="num text-[11px] text-mute">de {brl(card.total)}</span>
        </div>
      )}
      {(piece.part === "aceita" || (piece.part === "inteira" && piece.stage === "aceita")) && paid && paid.count > 0 && (
        <div className="mt-2">
          <Badge tone="brand">pago {brl(paid.value)}</Badge>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-mute">
        <span className="flex items-center gap-1.5 truncate">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: card.dentist.color }} />
          <span className="truncate">{card.dentist.name}</span>
        </span>
        {stale ? (
          <Badge tone="amber">{days} dias sem resposta</Badge>
        ) : (
          <span className="num shrink-0">{days === 0 ? "hoje" : `${days} d`}</span>
        )}
      </div>
      {piece.stage === "perdida" && (card.declineReason ?? card.lostReason) && <div className="mt-2 text-xs text-rose">{card.declineReason ?? card.lostReason}</div>}
    </div>
  );
}

function DraggableCard({ piece, alertDays, onDelete, onOpen }: { piece: Piece; alertDays: number; onDelete: (card: ProposalCard) => void; onOpen: (card: ProposalCard) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: piece.key, disabled: !piece.draggable });
  return (
    <div ref={setNodeRef} {...(piece.draggable ? listeners : {})} {...(piece.draggable ? attributes : {})} className={cx(isDragging && "opacity-30")}>
      <CardView piece={piece} alertDays={alertDays} onDelete={onDelete} onOpen={onOpen} />
    </div>
  );
}

const CLOSED_LIMIT = 25;

function Column({ stage, cards: all, alertDays, onDelete, onOpen }: { stage: Stage; cards: Piece[]; alertDays: number; onDelete: (card: ProposalCard) => void; onOpen: (card: ProposalCard) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = all.reduce((s, c) => s + c.value, 0);
  const closed = stage === "aceita" || stage === "perdida";
  const cards = closed ? all.slice(0, CLOSED_LIMIT) : all;
  return (
    <div ref={setNodeRef} className={cx("flex w-72 shrink-0 snap-start scroll-ml-4 flex-col rounded-xl bg-black/4 transition-colors max-sm:w-[82vw]", isOver && "bg-brand-soft ring-2 ring-brand/40")}>
      <header className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-sm font-semibold">
          {STAGE_LABEL[stage]} <span className="num ml-1 font-normal text-mute">{all.length}</span>
        </h2>
        <span className="num text-xs text-mute">{brl(total)}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100vh - 220px)" }}>
        {cards.map((c) => (
          <DraggableCard key={c.key} piece={c} alertDays={alertDays} onDelete={onDelete} onOpen={onOpen} />
        ))}
        {cards.length === 0 && <div className="rounded-lg border border-dashed border-line-2 p-4 text-center text-xs text-mute">Solte aqui</div>}
        {closed && all.length > CLOSED_LIMIT && <div className="py-2 text-center text-xs text-mute">mostrando as {CLOSED_LIMIT} mais recentes de {all.length}</div>}
      </div>
    </div>
  );
}

export default function Kanban() {
  const { clinic } = useClinic();
  const toast = useToast();
  const [cards, setCards] = useState<ProposalCard[] | null>(null);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [dentistId, setDentistId] = useState("");
  const [active, setActive] = useState<Piece | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<ProposalCard | null>(null);
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  const [deleteFor, setDeleteFor] = useState<ProposalCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const alertDays = clinic?.settings.followUpAlertDays ?? 7;

  async function remove(card: ProposalCard) {
    setDeleting(true);
    try {
      await api.del(`/proposals/${card.id}`);
      setCards((cs) => cs?.filter((c) => c.id !== card.id) ?? null);
      toast("Orçamento excluído");
      setDeleteFor(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao excluir", "error");
    } finally {
      setDeleting(false);
    }
  }

  const load = () => api.get<ProposalCard[]>(`/proposals${dentistId ? `?dentistId=${dentistId}` : ""}`).then(setCards);
  useEffect(() => {
    api.get<Dentist[]>("/dentists").then(setDentists);
  }, []);
  useEffect(() => {
    setCards(null);
    load().catch((e) => toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dentistId]);

  const pieces = useMemo(() => (cards ?? []).flatMap(splitCard), [cards]);
  const byStage = useMemo(() => {
    const m = Object.fromEntries(STAGES.map((s) => [s, [] as Piece[]])) as Record<Stage, Piece[]>;
    for (const p of pieces) m[p.stage].push(p);
    for (const s of STAGES) m[s].sort((a, b) => new Date(b.card.stageChangedAt).getTime() - new Date(a.card.stageChangedAt).getTime());
    return m;
  }, [pieces]);

  // Mouse: arrasta após 6px. Toque: só após segurar 250 ms, para a rolagem continuar livre.
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));

  // Mover vale para os itens ainda pendentes da proposta (ou para ela inteira, se não está dividida).
  async function move(card: ProposalCard, stage: Stage, reason?: string) {
    try {
      await api.patch(`/proposals/${card.id}/stage`, { stage, lostReason: reason });
      toast(`${card.patient.name} → ${STAGE_LABEL[stage]}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
    await load().catch(() => {});
  }

  function onDragStart(e: DragStartEvent) {
    setActive(pieces.find((p) => p.key === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const piece = pieces.find((p) => p.key === e.active.id);
    const stage = e.over?.id as Stage | undefined;
    if (!piece || !stage || stage === piece.stage) return;
    if (stage === "perdida") {
      setLostFor(piece.card);
      return;
    }
    void move(piece.card, stage);
  }

  return (
    <div className="px-4 py-5 sm:px-8 sm:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Propostas</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            Clique num cartão para abrir o plano de ação e aceitar ou recusar item a item: a parte aceita vai para “Aceita”, a recusada para “Perdida” e o que falta decidir continua na etapa. Arrastar move o que ainda está pendente (no celular, segure o cartão ou mude a etapa dentro dele). Apresentadas há mais de {alertDays} dias ficam marcadas para follow-up.
          </p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)} className="w-56 max-sm:flex-1">
            <option value="">Todos os dentistas</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Link to="/novo-plano">
            <Button variant="primary">Novo plano</Button>
          </Link>
        </div>
      </header>

      {!cards ? (
        <Spinner />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
            {STAGES.map((s) => (
              <Column key={s} stage={s} cards={byStage[s]} alertDays={alertDays} onDelete={setDeleteFor} onOpen={(c) => setOpenId(c.id)} />
            ))}
          </div>
          <DragOverlay>{active ? <div className="w-72"><CardView piece={active} alertDays={alertDays} dragging /></div> : null}</DragOverlay>
        </DndContext>
      )}

      <PlanoAcaoModal
        proposalId={openId}
        onClose={(changed) => {
          setOpenId(null);
          if (changed) void load().catch(() => {});
        }}
      />

      <Modal open={!!deleteFor} onClose={() => setDeleteFor(null)} title="Excluir orçamento?">
        <p className="text-sm text-ink-2">
          O orçamento de <strong>{deleteFor?.patient.name}</strong> ({deleteFor?.title}, {deleteFor ? brl(deleteFor.total) : ""}) será removido do OdontoPlan, junto com fases, itens e histórico. Não dá para desfazer.
        </p>
        {deleteFor?.externalId && (
          <p className="mt-2 text-sm text-ink-2">Ele veio do Clinicorp, onde continua existindo: a API deles não permite excluir. Aqui ele não voltará nas próximas sincronizações.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setDeleteFor(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => deleteFor && void remove(deleteFor)} disabled={deleting}>
            {deleting ? "Excluindo…" : "Excluir"}
          </Button>
        </div>
      </Modal>

      <Modal open={!!lostFor} onClose={() => setLostFor(null)} title="Marcar como perdida">
        <p className="text-sm text-ink-2">
          Proposta de <strong>{lostFor?.patient.name}</strong> ({brl(lostFor?.total ?? 0)}). Qual foi o motivo?
        </p>
        <Select value={lostReason} onChange={(e) => setLostReason(e.target.value)} className="mt-3">
          {LOST_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setLostFor(null)}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (lostFor) void move(lostFor, "perdida", lostReason);
              setLostFor(null);
            }}
          >
            Confirmar perda
          </Button>
        </div>
      </Modal>
    </div>
  );
}
