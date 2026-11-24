export class ApiError extends Error {
  constructor(message: string, public status: number, public issues?: unknown) {
    super(message);
  }
}

// Em produção o frontend (Vercel) fala com o backend em outro domínio (Railway):
// VITE_API_URL = URL pública do backend, sem /api. Em dev fica vazio e o Vite faz proxy.
const BASE = `${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")}/api`;

const TOKEN_KEY = "odontoplan.token";
export const AUTH_EVENT = "odontoplan:auth-required";
export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* navegação privada: segue sem persistir */
  }
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: { error?: string; issues?: unknown; code?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401 && path !== "/login") {
    setToken(null);
    window.dispatchEvent(new Event(AUTH_EVENT));
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Erro ${res.status}`, res.status, data?.issues);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
