import "./lib/env.js";
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { api } from "./routes/index.js";
import { isAiEnabled, aiModel } from "./ai/AiService.js";
import { assertAuthConfigured, isAuthEnabled, login, requireAuth } from "./lib/auth.js";

assertAuthConfigured();

const app = express();
app.set("trust proxy", 1); // Railway fica atrás de proxy: req.ip = IP real (limite de login)

// CORS_ORIGIN = origens permitidas separadas por vírgula (ex.: https://odontoplan.vercel.app).
// Sem a variável (uso local) aceita qualquer origem.
const origins = (process.env.CORS_ORIGIN ?? "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : undefined));
app.use(express.json({ limit: "1mb" }));
app.post("/api/login", login);
app.use("/api", requireAuth, api);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Dados inválidos", issues: err.issues });
  }
  const message = err instanceof Error ? err.message : "Erro interno";
  const status = /não encontrad|not found/i.test(message) ? 404 : /Entrada mínima|permite de|installments|Entrada maior|Sem taxa/i.test(message) ? 400 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: message });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`OdontoPlan API na porta ${port}  ·  IA: ${isAiEnabled() ? aiModel() : "desligada (fallback)"}  ·  senha de acesso: ${isAuthEnabled() ? "ligada" : "desligada (local)"}`);
});
