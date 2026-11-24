import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { Badge, Button, useToast } from "./ui";

type SyncResult = { source: string; days: number; result: Record<string, number> };

function SyncPanel() {
  const { clinic, reload } = useClinic();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const real = clinic?.sync.source === "clinicorp";
  const last = clinic?.sync.lastSyncAt ? new Date(clinic.sync.lastSyncAt) : null;

  async function sync() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post<SyncResult>("/sync?days=30");
      const n = r.result;
      toast(`Sincronizado: ${n.estimates} orçamentos, ${n.appointments} consultas, ${n.patients} pacientes, ${n.payments} pagamentos`);
      await reload();
      // Recarrega a tela atual para refletir os dados novos.
      navigate(0);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao sincronizar", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span>Dados: {real ? "Clinicorp" : "Clinicorp (mock)"}</span>
        {real && <Badge tone="green">conectado</Badge>}
      </div>
      <div className="mb-2">{last ? `Último sync: ${last.toLocaleDateString("pt-BR")} ${last.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Nunca sincronizado"}</div>
      <Button size="sm" className="w-full" onClick={() => void sync()} disabled={busy} title="Importa os últimos 30 dias do Clinicorp (≈7 requisições da cota de 25/hora)">
        {busy ? "Sincronizando…" : "Sincronizar agora"}
      </Button>
    </div>
  );
}

const nav = [
  { to: "/", label: "Dashboard", icon: "▦", end: true },
  { to: "/novo-plano", label: "Novo plano", icon: "+" },
  { to: "/propostas", label: "Propostas", icon: "☰" },
  { to: "/risco", label: "Pacientes em risco", icon: "◔" },
  { to: "/precificacao", label: "Precificação", icon: "◪" },
  { to: "/configuracoes", label: "Configurações", icon: "⚙" },
];

export default function Shell() {
  const { clinic } = useClinic();
  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-card">
        <div className="flex items-center gap-3 px-5 pb-4 pt-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: clinic?.primaryColor ?? "#0F766E" }}>
            <span className="font-serif text-lg font-semibold">S</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{clinic?.name ?? "OdontoPlan"}</div>
            <div className="truncate text-xs text-mute">{clinic ? `${clinic.city}/${clinic.state}` : "carregando…"}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? "bg-brand-soft font-medium text-brand-2" : "text-ink-2 hover:bg-paper hover:text-ink"}`
              }
            >
              <span className="w-4 text-center text-base leading-none opacity-70">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-5 pb-5 text-xs text-mute">
          <div>
            <div className="mb-1">Textos por IA</div>
            {clinic?.ai.enabled ? <Badge tone="green">ligada · {clinic.ai.model}</Badge> : <Badge>desligada · usando modelos padrão</Badge>}
          </div>
          <SyncPanel />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
