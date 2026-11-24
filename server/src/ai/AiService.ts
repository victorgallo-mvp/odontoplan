// ─────────────────────────────────────────────────────────────────────────────
// Camada de IA (Claude API) com fallback obrigatório.
//
// Regras:
//  • Só TEXTO sai daqui. Números (totais, parcelas, scores) são calculados em
//    src/domain e injetados prontos no prompt — a IA nunca os inventa.
//  • LGPD: nunca enviamos nome completo do paciente, telefone, e-mail, data de
//    nascimento nem anotações clínicas. Vai apenas o PRIMEIRO NOME (ou "o
//    paciente"), procedimentos, fases e valores. Veja `sanitizeFirstName`.
//  • Toda saída é rascunho: a UI sempre exibe em campo editável antes de
//    virar documento final.
//  • Sem ANTHROPIC_API_KEY (ou em qualquer erro/timeout) → templates de fallback.
// ─────────────────────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import { fallbackClassifyProcedure, fallbackProposalTexts, fallbackReactivationMessage } from "./fallback.js";
import type { AiSource, ProposalTextInput, ProposalTexts, ReactivationInput } from "./types.js";
import { formatBRL } from "../domain/money.js";

// Default conforme especificação do produto; configurável por env.
const DEFAULT_MODEL = "claude-sonnet-4-5";
const TIMEOUT_MS = 25_000;

let client: Anthropic | null = null;

export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

function getClient(): Anthropic | null {
  if (!isAiEnabled()) return null;
  if (!client) client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  return client;
}

/** LGPD: reduz qualquer nome ao primeiro nome, sem sobrenomes. */
export function sanitizeFirstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "o paciente";
}

async function askClaude(system: string, user: string, maxTokens = 1500): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.messages.create({
      model: aiModel(),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch (err) {
    console.warn("[ai] falha na API, usando fallback:", err instanceof Error ? err.message : err);
    return null;
  }
}

function extractJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

const PROPOSAL_SYSTEM = `Você escreve textos de propostas de tratamento odontológico para pacientes leigos, em português do Brasil.
Tom: acolhedor, claro, confiante, sem jargão e sem exageros comerciais. Nunca prometa resultados garantidos.
Nunca invente valores, prazos ou procedimentos além dos informados. Não use emojis nem markdown.
Responda SOMENTE com JSON válido no formato:
{"summary": string, "phases": string[], "benefits": string}
- summary: 2 a 3 frases resumindo o plano em linguagem leiga, dirigindo-se ao paciente pelo primeiro nome.
- phases: uma explicação de 1 a 3 frases por fase, na mesma ordem recebida, explicando o que será feito e por quê.
- benefits: um parágrafo curto sobre os benefícios de concluir o tratamento e a segurança de ser acompanhado pela equipe.`;

export async function generateProposalTexts(input: ProposalTextInput): Promise<{ texts: ProposalTexts; source: AiSource }> {
  const safeInput: ProposalTextInput = { ...input, patientFirstName: sanitizeFirstName(input.patientFirstName) };
  const fallback = fallbackProposalTexts(safeInput);
  if (!isAiEnabled()) return { texts: fallback, source: "fallback" };

  // Só o necessário vai para a API: primeiro nome, dentista, clínica, fases, procedimentos, valores.
  const user = JSON.stringify(
    {
      paciente_primeiro_nome: safeInput.patientFirstName,
      dentista: safeInput.dentistName,
      clinica: safeInput.clinicName,
      investimento_total: formatBRL(safeInput.total),
      fases: safeInput.phases.map((p, i) => ({
        ordem: i + 1,
        nome: p.name,
        procedimentos: p.items.map((it) => ({ nome: it.name, quantidade: it.quantity, categoria: it.category, o_que_e: it.description ?? undefined })),
      })),
    },
    null,
    2,
  );

  const raw = await askClaude(PROPOSAL_SYSTEM, user);
  const parsed = raw ? extractJson<Partial<ProposalTexts>>(raw) : null;
  if (!parsed || typeof parsed.summary !== "string" || !Array.isArray(parsed.phases) || typeof parsed.benefits !== "string") {
    return { texts: fallback, source: "fallback" };
  }
  const phases = safeInput.phases.map((_, i) => (typeof parsed.phases![i] === "string" && parsed.phases![i].trim() ? parsed.phases![i] : fallback.phases[i]));
  return { texts: { summary: parsed.summary.trim(), phases, benefits: parsed.benefits.trim() }, source: "ai" };
}

const REACTIVATION_SYSTEM = `Você é a recepção de uma clínica odontológica brasileira escrevendo uma mensagem de WhatsApp para reaproximar um paciente que se afastou.
Tom: humano, caloroso, curto (máximo 5 frases), sem culpa, sem pressão de venda, sem promoções. Pode usar no máximo 1 emoji.
Trate o paciente pelo primeiro nome. Termine com uma pergunta simples que facilite responder (ex.: período do dia preferido).
Não mencione valores. Não invente informações clínicas. Responda apenas com o texto da mensagem, sem aspas nem explicações.`;

export async function generateReactivationMessage(input: ReactivationInput): Promise<{ message: string; source: AiSource }> {
  const safe: ReactivationInput = { ...input, patientFirstName: sanitizeFirstName(input.patientFirstName) };
  const fallback = fallbackReactivationMessage(safe);
  if (!isAiEnabled()) return { message: fallback, source: "fallback" };

  const user = JSON.stringify(
    {
      paciente_primeiro_nome: safe.patientFirstName,
      clinica: safe.clinicName,
      dentista: safe.dentistName,
      meses_desde_ultima_consulta: safe.monthsSinceLastVisit === null ? null : Math.floor(safe.monthsSinceLastVisit),
      contexto: safe.reasons,
      tratamentos_aprovados_pendentes: safe.pendingTreatments,
    },
    null,
    2,
  );
  const raw = await askClaude(REACTIVATION_SYSTEM, user, 600);
  return raw ? { message: raw, source: "ai" } : { message: fallback, source: "fallback" };
}

/**
 * Stub para o futuro: sugerir categoria de procedimentos novos vindos do
 * Clinicorp. A sugestão sempre entra com category_confirmed = false.
 */
export async function classifyProcedure(name: string): Promise<{ category: "clinico" | "funcional" | "estetico"; confidence: number; source: AiSource }> {
  const fb = fallbackClassifyProcedure(name);
  if (!isAiEnabled()) return { ...fb, source: "fallback" };
  const raw = await askClaude(
    `Classifique procedimentos odontológicos em exatamente uma categoria: "clinico" (saúde: restauração, endodontia, exodontia, periodontia, prevenção), "funcional" (prótese, implante, ortodontia, oclusão) ou "estetico" (clareamento, facetas, lentes, harmonização). Responda só com JSON {"category": string, "confidence": number}.`,
    name,
    100,
  );
  const parsed = raw ? extractJson<{ category?: string; confidence?: number }>(raw) : null;
  if (parsed && (parsed.category === "clinico" || parsed.category === "funcional" || parsed.category === "estetico")) {
    return { category: parsed.category, confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8, source: "ai" };
  }
  return { ...fb, source: "fallback" };
}
