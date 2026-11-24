export interface ProposalTextInput {
  /** Só o primeiro nome (LGPD) */
  patientFirstName: string;
  dentistName: string;
  clinicName: string;
  phases: { name: string; items: { name: string; quantity: number; category: string; description?: string | null }[] }[];
  total: number;
}

export interface ProposalTexts {
  summary: string; // resumo leigo do plano
  phases: string[]; // uma explicação por fase, na mesma ordem
  benefits: string; // parágrafo de benefícios/confiança
}

export interface ReactivationInput {
  patientFirstName: string;
  clinicName: string;
  dentistName?: string;
  monthsSinceLastVisit: number | null;
  reasons: string[]; // motivos do score, já em texto
  pendingTreatments: string[]; // nomes de procedimentos aprovados e não feitos
}

export type AiSource = "ai" | "fallback";
