import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { brl } from "../lib/format";
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_HINT, CATEGORY_LABEL, type Category, type ClinicSettings, type PlanTemplate, type Procedure } from "../lib/types";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, cx, useToast } from "../components/ui";

type Tab = "servicos" | "pagamento" | "modelos";
const TABS: { id: Tab; label: string }[] = [
  { id: "servicos", label: "Serviços e valores" },
  { id: "pagamento", label: "Pagamento e regras" },
  { id: "modelos", label: "Modelos de plano" },
];

export default function Configuracoes() {
  const [tab, setTab] = useState<Tab>("servicos");
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="mt-1 text-sm text-ink-2">Organize os serviços, os valores de tabela, o tipo de cada tratamento, as regras de pagamento e os modelos de plano.</p>
      </header>
      <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx("-mb-px border-b-2 px-4 py-2 text-sm font-medium", tab === t.id ? "border-brand text-brand-2" : "border-transparent text-ink-2 hover:text-ink")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "servicos" && <Servicos />}
      {tab === "pagamento" && <Pagamento />}
      {tab === "modelos" && <Modelos />}
    </div>
  );
}

// ── Serviços, valores e tipo de tratamento ───────────────────────────────────
function CategoryButtons({ value, confirmed, onChange, disabled }: { value: Category | null; confirmed: boolean; onChange: (c: Category) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line-2" role="group" aria-label="Tipo de tratamento">
      {CATEGORIES.map((c) => {
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            title={CATEGORY_HINT[c]}
            onClick={() => onChange(c)}
            className={cx("px-2.5 py-1.5 text-xs font-medium transition-colors", on ? "text-white" : "bg-card text-ink-2 hover:bg-paper")}
            style={on ? { background: CATEGORY_COLOR[c], opacity: confirmed ? 1 : 0.55 } : undefined}
          >
            {CATEGORY_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

function Servicos() {
  const toast = useToast();
  const [rows, setRows] = useState<Procedure[] | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "" | "pendente">("");
  const [showInactive, setShowInactive] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", category: "clinico" as Category, basePrice: 0, durationMin: 60 });
  const [busy, setBusy] = useState(false);

  const load = () => api.get<Procedure[]>("/procedures?all=1").then(setRows);
  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [toast]);

  const list = useMemo(
    () =>
      (rows ?? []).filter(
        (p) =>
          (showInactive || p.active) &&
          (cat === "" || (cat === "pendente" ? !p.categoryConfirmed : p.category === cat)) &&
          (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.code.toLowerCase().includes(q.toLowerCase())),
      ),
    [rows, q, cat, showInactive],
  );
  const active = (rows ?? []).filter((p) => p.active);
  const pending = active.filter((p) => !p.categoryConfirmed).length;

  async function patch(id: string, data: Partial<Pick<Procedure, "name" | "category" | "basePrice" | "durationMin" | "active">>) {
    try {
      const updated = await api.patch<Procedure>(`/procedures/${id}`, data);
      setRows((rs) => rs?.map((r) => (r.id === id ? updated : r)) ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao salvar", "error");
      void load();
    }
  }

  async function setCategoryForPicked(c: Category) {
    setBusy(true);
    await Promise.all([...picked].map((id) => patch(id, { category: c })));
    toast(`${picked.size} ${picked.size === 1 ? "serviço marcado" : "serviços marcados"} como ${CATEGORY_LABEL[c]}`);
    setPicked(new Set());
    setBusy(false);
  }

  async function suggest() {
    setBusy(true);
    try {
      const r = await api.post<{ reviewed: number; changed: number }>("/procedures/suggest-categories");
      await load();
      setCat("pendente");
      toast(`${r.reviewed} serviços analisados pelo nome, ${r.changed} com tipo sugerido diferente. Revise e confirme.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (draft.name.trim().length < 2) return toast("Informe o nome do serviço", "error");
    setBusy(true);
    try {
      await api.post("/procedures", draft);
      await load();
      setCreating(false);
      setDraft({ name: "", category: "clinico", basePrice: 0, durationMin: 60 });
      toast("Serviço criado");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <Spinner />;
  const allPicked = list.length > 0 && list.every((p) => picked.has(p.id));
  const chip = (on: boolean) => cx("rounded-full border px-3 py-1 text-xs", on ? "border-ink bg-ink text-white" : "border-line-2 bg-card text-ink-2 hover:bg-paper");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {CATEGORIES.map((c) => (
          <div key={c} className="card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
              {CATEGORY_LABEL[c]}
              <span className="num ml-auto font-normal text-mute">{active.filter((p) => p.category === c).length}</span>
            </div>
            <p className="mt-1 text-xs text-ink-2">{CATEGORY_HINT[c]}</p>
          </div>
        ))}
      </div>

      {pending > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-soft px-4 py-3 text-sm text-amber">
          <span>
            <strong>{pending}</strong> {pending === 1 ? "serviço ainda está" : "serviços ainda estão"} com o tipo a confirmar (vieram do Clinicorp sem classificação). Enquanto isso, entram como “Clínico”.
          </span>
          <Button size="sm" onClick={() => void suggest()} disabled={busy}>
            Sugerir tipos pelo nome
          </Button>
        </div>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input placeholder="Buscar serviço…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-64" />
          <button className={chip(cat === "")} onClick={() => setCat("")}>
            Todos
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} className={chip(cat === c)} onClick={() => setCat(c)}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
          <button className={chip(cat === "pendente")} onClick={() => setCat("pendente")}>
            A confirmar {pending > 0 && <span className="num">({pending})</span>}
          </button>
          <label className="ml-2 flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Mostrar inativos
          </label>
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
            + Novo serviço
          </Button>
        </div>

        {picked.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-brand-soft px-3 py-2 text-sm">
            <span className="font-medium text-brand-2">
              {picked.size} {picked.size === 1 ? "selecionado" : "selecionados"}
            </span>
            <span className="text-ink-2">Definir tipo:</span>
            <CategoryButtons value={null} confirmed onChange={(c) => void setCategoryForPicked(c)} disabled={busy} />
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Limpar seleção
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-xs text-mute">
                <th className="w-8 pb-2">
                  <input type="checkbox" aria-label="Selecionar todos" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(list.map((p) => p.id)) : new Set())} />
                </th>
                <th className="pb-2 font-medium">Serviço</th>
                <th className="pb-2 font-medium">Tipo de tratamento</th>
                <th className="pb-2 font-medium">Valor de tabela (R$)</th>
                <th className="pb-2 font-medium">Duração (min)</th>
                <th className="pb-2 text-right font-medium">Ativo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((p) => (
                <tr key={p.id} className={cx(!p.active && "opacity-55")}>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${p.name}`}
                      checked={picked.has(p.id)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(p.id);
                          else n.delete(p.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      key={p.name}
                      defaultValue={p.name}
                      aria-label="Nome do serviço"
                      className="h-9 w-full min-w-56 border-transparent bg-transparent px-2 font-medium hover:border-line-2 focus:bg-card"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v.length >= 2 && v !== p.name) void patch(p.id, { name: v });
                        else e.target.value = p.name;
                      }}
                    />
                    <div className="px-2 text-xs text-mute">
                      {p.code}
                      {p.externalId ? " · Clinicorp" : " · criado aqui"}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <CategoryButtons value={p.category} confirmed={p.categoryConfirmed} onChange={(c) => void patch(p.id, { category: c })} />
                      {!p.categoryConfirmed && <Badge tone="amber">a confirmar</Badge>}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      key={p.basePrice}
                      type="number"
                      min={0}
                      step={10}
                      defaultValue={p.basePrice}
                      aria-label={`Valor de tabela de ${p.name}`}
                      className="num h-9 w-32"
                      onBlur={(e) => {
                        const v = Math.max(0, Number(e.target.value) || 0);
                        if (v !== p.basePrice) void patch(p.id, { basePrice: v });
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      key={p.durationMin}
                      type="number"
                      min={5}
                      step={5}
                      defaultValue={p.durationMin}
                      aria-label={`Duração de ${p.name}`}
                      className="num h-9 w-20"
                      onBlur={(e) => {
                        const v = Math.min(600, Math.max(5, Math.round(Number(e.target.value) || 60)));
                        if (v !== p.durationMin) void patch(p.id, { durationMin: v });
                      }}
                    />
                  </td>
                  <td className="py-2 text-right">
                    <input type="checkbox" aria-label={`${p.name} ativo`} checked={p.active} onChange={(e) => void patch(p.id, { active: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="py-8 text-center text-sm text-mute">Nenhum serviço neste filtro.</p>}
        <p className="mt-3 text-xs text-mute">As alterações são salvas ao sair do campo. Serviços com nome, valor ou situação editados aqui deixam de ser sobrescritos pela sincronização do Clinicorp. Serviços inativos não aparecem no “Novo plano”.</p>
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Novo serviço">
        <div className="space-y-4">
          <Field label="Nome">
            <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="ex.: Faceta em resina" />
          </Field>
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Tipo de tratamento</span>
            <CategoryButtons value={draft.category} confirmed onChange={(c) => setDraft({ ...draft, category: c })} />
            <p className="mt-1 text-xs text-mute">{CATEGORY_HINT[draft.category]}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Valor de tabela (R$)">
              <Input type="number" min={0} step={10} value={draft.basePrice} onChange={(e) => setDraft({ ...draft, basePrice: Math.max(0, Number(e.target.value) || 0) })} className="num" />
            </Field>
            <Field label="Duração (min)">
              <Input type="number" min={5} step={5} value={draft.durationMin} onChange={(e) => setDraft({ ...draft, durationMin: Math.max(5, Math.round(Number(e.target.value) || 60)) })} className="num" />
            </Field>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setCreating(false)}>Cancelar</Button>
          <Button variant="primary" onClick={() => void create()} disabled={busy}>
            Criar serviço
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ── Pagamento e regras ───────────────────────────────────────────────────────
type Tier = { installments: number; feePct: number };

function Pagamento() {
  const { clinic, reload } = useClinic();
  const toast = useToast();
  const [form, setForm] = useState<ClinicSettings | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!clinic || dirty) return;
    setForm(clinic.settings);
    setTiers(clinic.cardFeeTiers.map((t) => ({ installments: t.installments, feePct: t.feePct })));
  }, [clinic, dirty]);

  if (!form) return <Spinner />;
  const set = <K extends keyof ClinicSettings>(k: K, v: ClinicSettings[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };
  const num = (v: string, max = Infinity) => Math.min(max, Math.max(0, Number(v) || 0));
  const example = 5000;
  const minDown = form.minDownPaymentMode === "fixed" ? Math.min(form.minDownPaymentFixed, example) : (example * form.minDownPaymentPct) / 100;

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await api.patch("/settings", {
        cashDiscountPct: form.cashDiscountPct,
        passCardFeeToPatient: form.passCardFeeToPatient,
        minDownPaymentMode: form.minDownPaymentMode,
        minDownPaymentPct: form.minDownPaymentPct,
        minDownPaymentFixed: form.minDownPaymentFixed,
        maxOwnInstallments: Math.max(1, Math.round(form.maxOwnInstallments)),
        proposalValidityDays: Math.max(1, Math.round(form.proposalValidityDays)),
        priceAlertTolerancePct: form.priceAlertTolerancePct,
        followUpAlertDays: Math.max(1, Math.round(form.followUpAlertDays)),
        cardFeeTiers: tiers.filter((t) => t.installments >= 1),
      });
      setDirty(false);
      reload();
      toast("Configurações salvas");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Card title="Parcelamento próprio (boleto/pix)">
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Entrada mínima</span>
              <div className="flex items-center gap-2">
                <Select value={form.minDownPaymentMode} onChange={(e) => set("minDownPaymentMode", e.target.value as "pct" | "fixed")} className="w-44" aria-label="Como a entrada mínima é definida">
                  <option value="pct">% do total</option>
                  <option value="fixed">Valor fixo (R$)</option>
                </Select>
                {form.minDownPaymentMode === "pct" ? (
                  <Input type="number" min={0} max={100} step={5} value={form.minDownPaymentPct} onChange={(e) => set("minDownPaymentPct", num(e.target.value, 100))} className="num w-28" aria-label="Entrada mínima em %" />
                ) : (
                  <Input type="number" min={0} step={50} value={form.minDownPaymentFixed} onChange={(e) => set("minDownPaymentFixed", num(e.target.value))} className="num w-32" aria-label="Entrada mínima em R$" />
                )}
              </div>
              <p className="mt-1 text-xs text-mute">
                Num plano de {brl(example)}, a entrada mínima seria <span className="num">{brl(minDown)}</span>. No “Novo plano” a entrada pode ser digitada em % ou em R$.
              </p>
            </div>
            <Field label="Máximo de parcelas">
              <Input type="number" min={1} max={60} value={form.maxOwnInstallments} onChange={(e) => set("maxOwnInstallments", num(e.target.value, 60))} className="num w-28" />
            </Field>
          </div>
        </Card>

        <Card title="À vista e propostas">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Desconto à vista (%)">
              <Input type="number" min={0} max={100} step={1} value={form.cashDiscountPct} onChange={(e) => set("cashDiscountPct", num(e.target.value, 100))} className="num" />
            </Field>
            <Field label="Validade da proposta (dias)">
              <Input type="number" min={1} max={365} value={form.proposalValidityDays} onChange={(e) => set("proposalValidityDays", num(e.target.value, 365))} className="num" />
            </Field>
            <Field label="Alerta de preço fora da tabela (± %)" hint="Destaca o item no “Novo plano”.">
              <Input type="number" min={0} max={100} value={form.priceAlertTolerancePct} onChange={(e) => set("priceAlertTolerancePct", num(e.target.value, 100))} className="num" />
            </Field>
            <Field label="Follow-up após apresentar (dias)" hint="Marca o cartão no Kanban.">
              <Input type="number" min={1} max={90} value={form.followUpAlertDays} onChange={(e) => set("followUpAlertDays", num(e.target.value, 90))} className="num" />
            </Field>
          </div>
        </Card>
      </div>

      <Card
        title="Cartão de crédito"
        action={
          <Button
            size="sm"
            onClick={() => {
              setTiers((ts) => [...ts, { installments: Math.max(0, ...ts.map((t) => t.installments)) + 1, feePct: ts[ts.length - 1]?.feePct ?? 0 }]);
              setDirty(true);
            }}
          >
            + Parcela
          </Button>
        }
      >
        <label className="mb-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.passCardFeeToPatient} onChange={(e) => set("passCardFeeToPatient", e.target.checked)} />
          <span>
            Repassar a taxa da maquininha ao paciente
            <span className="block text-xs text-mute">Ligado: o valor no cartão sobe para a clínica receber o total do plano. Desligado: a clínica absorve a taxa.</span>
          </span>
        </label>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-mute">
              <th className="pb-2 font-medium">Parcelas</th>
              <th className="pb-2 font-medium">Taxa da maquininha (%)</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tiers.map((t, i) => (
              <tr key={i}>
                <td className="num py-1.5">{t.installments}×</td>
                <td className="py-1.5">
                  <Input
                    type="number"
                    min={0}
                    max={99}
                    step={0.1}
                    value={t.feePct}
                    aria-label={`Taxa para ${t.installments} parcelas`}
                    onChange={(e) => {
                      setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, feePct: num(e.target.value, 99) } : x)));
                      setDirty(true);
                    }}
                    className="num h-9 w-28"
                  />
                </td>
                <td className="py-1.5 text-right">
                  {i === tiers.length - 1 && tiers.length > 1 && (
                    <button
                      className="rounded p-1 text-mute hover:bg-rose-soft hover:text-rose"
                      aria-label={`Remover ${t.installments} parcelas`}
                      onClick={() => {
                        setTiers((ts) => ts.slice(0, -1));
                        setDirty(true);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center gap-3 lg:col-span-2">
        <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Salvando…" : dirty ? "Salvar configurações" : "Salvo"}
        </Button>
        {dirty && <span className="text-xs text-mute">Há alterações não salvas. Elas valem para as próximas simulações; propostas já criadas mantêm a condição gravada.</span>}
      </div>
    </div>
  );
}

// ── Modelos de plano ─────────────────────────────────────────────────────────
function Modelos() {
  const toast = useToast();
  const [rows, setRows] = useState<PlanTemplate[] | null>(null);
  const [removing, setRemoving] = useState<PlanTemplate | null>(null);

  useEffect(() => {
    api.get<PlanTemplate[]>("/plan-templates").then(setRows).catch((e) => toast(e.message, "error"));
  }, [toast]);

  async function rename(t: PlanTemplate, name: string) {
    try {
      await api.patch(`/plan-templates/${t.id}`, { name });
      setRows((rs) => rs?.map((r) => (r.id === t.id ? { ...r, name } : r)) ?? null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function remove(t: PlanTemplate) {
    try {
      await api.del(`/plan-templates/${t.id}`);
      setRows((rs) => rs?.filter((r) => r.id !== t.id) ?? null);
      toast("Modelo excluído");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setRemoving(null);
  }

  if (!rows) return <Spinner />;
  if (rows.length === 0)
    return (
      <EmptyState
        title="Nenhum modelo de plano ainda"
        hint="Monte um plano em “Novo plano” (fases e procedimentos) e clique em “Salvar como modelo”. Ele aparece aqui e pode ser reaproveitado com os valores atuais da tabela."
        action={
          <Link to="/novo-plano">
            <Button variant="primary">Ir para Novo plano</Button>
          </Link>
        }
      />
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((t) => {
        const total = t.phases.reduce((s, ph) => s + ph.items.reduce((x, i) => x + i.procedure.basePrice * i.quantity, 0), 0);
        return (
          <Card
            key={t.id}
            title={
              <input
                key={t.name}
                defaultValue={t.name}
                aria-label="Nome do modelo"
                className="-mx-1 w-full rounded-md bg-transparent px-1 text-[15px] font-semibold hover:bg-paper focus:bg-paper"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v.length >= 2 && v !== t.name) void rename(t, v);
                  else e.target.value = t.name;
                }}
              />
            }
            action={
              <Button size="sm" variant="ghost" className="text-rose" onClick={() => setRemoving(t)}>
                Excluir
              </Button>
            }
          >
            <ol className="space-y-3">
              {t.phases.map((ph) => (
                <li key={ph.id}>
                  <div className="text-sm font-medium">{ph.name}</div>
                  <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
                    {ph.items.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[i.procedure.category] }} />
                          <span className="truncate">
                            {i.quantity > 1 ? `${i.quantity}× ` : ""}
                            {i.procedure.name}
                          </span>
                          {!i.procedure.active && <Badge tone="amber">inativo</Badge>}
                        </span>
                        <span className="num shrink-0">{brl(i.procedure.basePrice * i.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3 text-sm">
              <span className="text-ink-2">Total pela tabela atual</span>
              <span className="num font-semibold">{brl(total)}</span>
            </div>
          </Card>
        );
      })}
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Excluir modelo?">
        <p className="text-sm text-ink-2">
          O modelo <strong>{removing?.name}</strong> será excluído. Propostas já criadas a partir dele não mudam.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setRemoving(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => removing && void remove(removing)}>
            Excluir
          </Button>
        </div>
      </Modal>
    </div>
  );
}
