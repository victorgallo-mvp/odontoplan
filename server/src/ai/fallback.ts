// Templates estáticos usados quando não há ANTHROPIC_API_KEY (ou quando a API falha).
// Textos genéricos porém coerentes com o plano — o app precisa demonstrar tudo sem chave.
import type { ProposalTextInput, ProposalTexts, ReactivationInput } from "./types.js";
import { formatBRL } from "../domain/money.js";

const CATEGORY_PHRASE: Record<string, string> = {
  clinico: "recuperar a saúde bucal",
  funcional: "devolver função e conforto na mastigação",
  estetico: "deixar o sorriso mais bonito e harmonioso",
};

function listNames(items: { name: string; quantity: number }[]): string {
  const names = items.map((i) => (i.quantity > 1 ? `${i.name.toLowerCase()} (${i.quantity})` : i.name.toLowerCase()));
  if (names.length <= 1) return names[0] ?? "";
  return names.slice(0, -1).join(", ") + " e " + names[names.length - 1];
}

export function fallbackProposalTexts(input: ProposalTextInput): ProposalTexts {
  const categories = [...new Set(input.phases.flatMap((p) => p.items.map((i) => i.category)))];
  const goals = categories.map((c) => CATEGORY_PHRASE[c] ?? "cuidar da sua saúde bucal");
  const goalText = goals.length <= 1 ? goals[0] : goals.slice(0, -1).join(", ") + " e " + goals[goals.length - 1];
  const single = input.phases.length === 1;
  const summary =
    `${input.patientFirstName}, este plano foi preparado por ${input.dentistName} para ${goalText}. ` +
    (single
      ? `Reunimos tudo em uma única etapa, para resolver o que é necessário em poucas sessões, sem surpresas. `
      : `Organizamos o tratamento em ${input.phases.length} etapas, em ordem de prioridade: primeiro o que protege sua saúde, depois o que devolve função e, por fim, o acabamento estético. Cada etapa pode ser iniciada separadamente, respeitando seu tempo e seu orçamento. `) +
    `Qualquer dúvida sobre o que será feito, é só perguntar — explicamos quantas vezes for preciso.`;

  const phases = input.phases.map((p, i) => {
    const descs = p.items.filter((it) => it.description).slice(0, 2).map((it) => it.description!.replace(/\.$/, ""));
    const base = `Nesta etapa realizamos ${listNames(p.items)}.`;
    const extra = descs.length ? ` ${descs.join(". ")}.` : "";
    const when = i === 0 ? " É por onde começamos." : i === input.phases.length - 1 ? " É a etapa que finaliza o tratamento." : "";
    return base + extra + when;
  });

  const benefits =
    `Ao concluir o tratamento, você terá uma boca saudável, sem dor e sem focos de infecção, com dentes funcionando bem e um sorriso de que se orgulha. ` +
    `O investimento total de ${formatBRL(input.total)} pode ser dividido conforme as condições apresentadas a seguir. ` +
    `Nossa equipe acompanha cada fase de perto e está à disposição para tirar qualquer dúvida.`;

  return { summary, phases, benefits };
}

export function fallbackReactivationMessage(input: ReactivationInput): string {
  const months = input.monthsSinceLastVisit;
  const timeText = months === null ? "" : months >= 12 ? "faz mais de um ano que não nos vemos" : `faz uns ${Math.floor(months)} meses que não nos vemos`;
  const pending = input.pendingTreatments[0];
  const lines = [
    `Oi, ${input.patientFirstName}! Aqui é da ${input.clinicName} 😊`,
    timeText ? `Passando para dar um oi — ${timeText} e sentimos sua falta por aqui.` : "Passando para dar um oi e saber como você está.",
  ];
  if (pending) {
    lines.push(`Vi que o seu tratamento de ${pending.toLowerCase()} ficou parado. Que tal retomarmos? Dá para continuar de onde paramos, sem refazer nada.`);
  } else {
    lines.push("Que tal agendar uma revisão? É rápida, e é a melhor forma de evitar problemas maiores lá na frente.");
  }
  lines.push("Tenho horários esta semana e na próxima. Qual período fica melhor para você: manhã ou tarde?");
  return lines.join("\n\n");
}

/** Classificação por palavra-chave (stub) — usada quando a IA está indisponível. */
export function fallbackClassifyProcedure(name: string): { category: "clinico" | "funcional" | "estetico"; confidence: number } {
  const n = name.toLowerCase();
  if (/clare|facet|lente|harmon|toxina|preench|bichec|gengivoplast|microabras|recontorno/.test(n)) return { category: "estetico", confidence: 0.7 };
  if (/implante|pr[óo]tese|coroa|orto|aparelho|alinhador|conten[çc]|bruxismo|placa|enxerto|pino|onlay|inlay|overdenture|protocolo|oclus/.test(n)) return { category: "funcional", confidence: 0.7 };
  return { category: "clinico", confidence: 0.5 };
}
