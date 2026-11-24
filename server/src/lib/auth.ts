// ─────────────────────────────────────────────────────────────────────────────
// Senha de acesso única (APP_PASSWORD). O app guarda dados de pacientes: em
// produção ele não sobe sem senha. Sem APP_PASSWORD (uso local) fica aberto.
// O token é um HMAC da senha: trocar a senha derruba todas as sessões.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { isProduction } from "./env.js";

const password = () => process.env.APP_PASSWORD ?? "";
export const isAuthEnabled = () => password().length > 0;

export function assertAuthConfigured() {
  if (isProduction && !isAuthEnabled()) {
    throw new Error("APP_PASSWORD não definido. Em produção o OdontoPlan exige uma senha de acesso (dados de pacientes). Defina a variável e reinicie.");
  }
}

const sessionToken = () => createHmac("sha256", password()).update("odontoplan-session-v1").digest("hex");
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Limite de tentativas de login por IP (memória do processo)
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function login(req: Request, res: Response) {
  if (!isAuthEnabled()) return res.json({ token: null, required: false });
  const ip = req.ip ?? "?";
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." });
  }
  const given = typeof req.body?.password === "string" ? req.body.password : "";
  if (!safeEqual(given, password())) {
    attempts.set(ip, entry && entry.resetAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + WINDOW_MS });
    return res.status(401).json({ error: "Senha incorreta" });
  }
  attempts.delete(ip);
  res.json({ token: sessionToken(), required: true });
}

/** Protege tudo em /api, menos /health e /login. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled() || req.method === "OPTIONS" || req.path === "/health" || req.path === "/login") return next();
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token && safeEqual(token, sessionToken())) return next();
  res.status(401).json({ error: "Sessão expirada. Entre novamente.", code: "auth_required" });
}
