import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AUTH_EVENT, ApiError, api } from "./api";
import type { Clinic } from "./types";

type State = { clinic: Clinic | null; error: string | null; needsLogin: boolean; reload: () => Promise<void> };
const Ctx = createContext<State>({ clinic: null, error: null, needsLogin: false, reload: async () => {} });
export const useClinic = () => useContext(Ctx);

export function ClinicProvider({ children }: { children: ReactNode }) {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const reload = () =>
    api
      .get<Clinic>("/clinic")
      .then((c) => {
        setClinic(c);
        setError(null);
        setNeedsLogin(false);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setNeedsLogin(true);
        else setError(e.message);
      });
  useEffect(() => {
    void reload();
    const onAuth = () => setNeedsLogin(true);
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, []);
  return <Ctx.Provider value={{ clinic, error, needsLogin, reload }}>{children}</Ctx.Provider>;
}
