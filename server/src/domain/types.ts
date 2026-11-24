// Tipos de domínio — espelham os "enums em String" do schema.prisma.

export const CATEGORIES = ["clinico", "funcional", "estetico"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  clinico: "Clínico",
  funcional: "Funcional",
  estetico: "Estético",
};

export const STAGES = [
  "planejamento",
  "revisada",
  "apresentada",
  "negociacao",
  "aceita",
  "perdida",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  planejamento: "Em planejamento",
  revisada: "Revisada pelo dentista",
  apresentada: "Apresentada",
  negociacao: "Em negociação",
  aceita: "Aceita",
  perdida: "Perdida",
};

/** Status no vocabulário do Clinicorp, derivado do stage. */
export type EstimateStatus = "aprovado" | "recusado" | "pendente";
export function estimateStatusFromStage(stage: string): EstimateStatus {
  if (stage === "aceita") return "aprovado";
  if (stage === "perdida") return "recusado";
  return "pendente";
}

export type PaymentMethod = "avista" | "cartao" | "boleto";
export type PhaseStatus = "pendente" | "em_andamento" | "concluida";
export type AppointmentType = "avaliacao" | "procedimento" | "revisao";
export type AppointmentStatus = "agendada" | "realizada" | "faltou" | "cancelada";

export const ITEM_DECISIONS = ["pendente", "aceito", "recusado"] as const;
export type ItemDecision = (typeof ITEM_DECISIONS)[number];
