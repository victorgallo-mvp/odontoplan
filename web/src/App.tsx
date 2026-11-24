import { Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import { ToastProvider } from "./components/ui";
import { useEffect, useState } from "react";
import { api, setToken } from "./lib/api";
import { ClinicProvider, useClinic } from "./lib/clinic";
import { Button, Field, Input } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import NovoPlano from "./pages/NovoPlano";
import Kanban from "./pages/Kanban";
import Risco from "./pages/Risco";
import Proposta from "./pages/Proposta";
import Precificacao from "./pages/Precificacao";
import Configuracoes from "./pages/Configuracoes";

function Login() {
  const { reload } = useClinic();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ token: string | null }>("/login", { password });
      setToken(r.token);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <h1 className="text-lg font-semibold">OdontoPlan</h1>
        <p className="mt-1 text-sm text-ink-2">Digite a senha de acesso da clínica.</p>
        <Field label="Senha" className="mt-5">
          <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p className="mt-2 text-sm text-rose" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" className="mt-5 w-full" disabled={busy || !password}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </main>
  );
}

/** Banco vazio: com Clinicorp configurado oferece a primeira importação; senão, o seed. */
function EmptyDatabase({ error }: { error: string }) {
  const { reload } = useClinic();
  const [clinicorp, setClinicorp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ clinicorp?: boolean }>("/health").then((h) => setClinicorp(!!h.clinicorp)).catch(() => {});
  }, []);
  async function firstSync() {
    setBusy(true);
    setFailure(null);
    try {
      await api.post("/sync?days=90");
      await reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Falha ao sincronizar");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="card max-w-md p-8">
        <h1 className="text-lg font-semibold">Banco vazio</h1>
        {clinicorp ? (
          <>
            <p className="mt-2 text-sm text-ink-2">O Clinicorp está configurado, mas nada foi importado ainda. A primeira importação traz os últimos 90 dias (cerca de 15 das 25 requisições por hora da cota).</p>
            <Button variant="primary" className="mt-5" onClick={() => void firstSync()} disabled={busy}>
              {busy ? "Importando…" : "Importar do Clinicorp"}
            </Button>
            {failure && <p className="mt-3 text-sm text-rose">{failure}</p>}
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-2">{error}</p>
            <pre className="mt-4 rounded-lg bg-paper p-3 text-sm">npm run seed</pre>
          </>
        )}
      </div>
    </main>
  );
}

function SeedGate({ children }: { children: React.ReactNode }) {
  const { error, needsLogin } = useClinic();
  if (needsLogin) return <Login />;
  if (error) return <EmptyDatabase error={error} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ClinicProvider>
      <ToastProvider>
        <SeedGate>
          <Routes>
            <Route path="/propostas/:id" element={<Proposta />} />
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="novo-plano" element={<NovoPlano />} />
              <Route path="propostas" element={<Kanban />} />
              <Route path="risco" element={<Risco />} />
              <Route path="precificacao" element={<Precificacao />} />
              <Route path="configuracoes" element={<Configuracoes />} />
            </Route>
          </Routes>
        </SeedGate>
      </ToastProvider>
    </ClinicProvider>
  );
}
