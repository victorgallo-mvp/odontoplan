export type Category = "clinico" | "funcional" | "estetico";
export type Stage = "planejamento" | "revisada" | "apresentada" | "negociacao" | "aceita" | "perdida";
export type PaymentMethod = "avista" | "cartao" | "boleto";

export const STAGES: Stage[] = ["planejamento", "revisada", "apresentada", "negociacao", "aceita", "perdida"];
export const STAGE_LABEL: Record<Stage, string> = {
  planejamento: "Em planejamento",
  revisada: "Revisada pelo dentista",
  apresentada: "Apresentada",
  negociacao: "Em negociação",
  aceita: "Aceita",
  perdida: "Perdida",
};
export const CATEGORY_LABEL: Record<Category, string> = { clinico: "Clínico", funcional: "Funcional", estetico: "Estético" };
export const CATEGORIES: Category[] = ["clinico", "funcional", "estetico"];
export const CATEGORY_HINT: Record<Category, string> = {
  clinico: "Saúde: restauração, canal, extração, gengiva, prevenção",
  funcional: "Função: prótese, implante, ortodontia, oclusão",
  estetico: "Estética: clareamento, facetas, lentes, harmonização",
};
export const CATEGORY_COLOR: Record<Category, string> = { clinico: "#2a78d6", funcional: "#eb6834", estetico: "#1baf7a" };

export interface Clinic {
  id: string;
  name: string;
  city: string;
  state: string;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  settings: ClinicSettings;
  cardFeeTiers: { installments: number; feePct: number }[];
  paymentConfig: PaymentConfig;
  sync: { source: "clinicorp" | "mock"; lastSyncAt: string | null };
  ai: { enabled: boolean; model: string | null };
}

export interface ClinicSettings {
  priceAlertTolerancePct: number;
  followUpAlertDays: number;
  proposalValidityDays: number;
  cashDiscountPct: number;
  passCardFeeToPatient: boolean;
  minDownPaymentMode: "pct" | "fixed";
  minDownPaymentPct: number;
  minDownPaymentFixed: number;
  maxOwnInstallments: number;
}

export interface PaymentConfig {
  cashDiscountPct: number;
  passCardFeeToPatient: boolean;
  minDownPaymentPct: number;
  maxOwnInstallments: number;
  cardFees: { installments: number; feePct: number }[];
}

export interface Dentist { id: string; name: string; cro: string | null; specialty: string | null; color: string }
export interface Procedure { id: string; code: string; name: string; category: Category; categoryConfirmed: boolean; basePrice: number; durationMin: number; description: string | null; active: boolean; externalId?: string | null }
export interface PatientLite { id: string; name: string; phone: string | null; city: string | null; birthDate: string | null; lastVisitAt: string | null; email: string | null }

export interface Scenario {
  method: PaymentMethod;
  label: string;
  installments: number;
  downPayment: number;
  installmentValue: number;
  total: number;
  delta: number;
  ratePct: number;
  clinicNet: number;
}

export type ItemDecision = "pendente" | "aceito" | "recusado";
export const DECISION_LABEL: Record<ItemDecision, string> = { pendente: "Pendente", aceito: "Aceito", recusado: "Recusado" };
export interface ProposalItem { id: string; procedureId: string; description: string; toothRegion: string | null; quantity: number; referencePrice: number; unitPrice: number; total: number; decision: ItemDecision; declineReason: string | null; decidedAt: string | null; paidAt: string | null; procedure: Procedure }
export interface ActionPlanBucket { count: number; value: number }
export interface ActionPlanSummary { accepted: ActionPlanBucket; paid: ActionPlanBucket; toReceive: ActionPlanBucket; pending: ActionPlanBucket; declined: ActionPlanBucket; partial: boolean }
export interface ProposalPayment { id: string; amount: number; method: string; installmentNumber: number; installmentsTotal: number; dueDate: string; paidAt: string | null; status: "pago" | "pendente" | "atrasado" }
export interface PlanTemplate {
  id: string;
  name: string;
  phases: { id: string; order: number; name: string; items: { id: string; procedureId: string; quantity: number; procedure: { id: string; name: string; category: Category; basePrice: number; active: boolean } }[] }[];
}
export interface ProposalPhase { id: string; order: number; name: string; description: string | null; status: string; items: ProposalItem[] }
export interface Proposal {
  id: string;
  externalId?: string | null;
  title: string;
  stage: Stage;
  stageChangedAt: string;
  createdAt: string;
  presentedAt: string | null;
  decidedAt: string | null;
  validUntil: string;
  lostReason: string | null;
  referenceTotal: number;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod | null;
  installments: number | null;
  downPayment: number | null;
  installmentValue: number | null;
  finalAmount: number | null;
  summaryText: string | null;
  benefitsText: string | null;
  observations: string | null;
  patient: { id: string; name: string; birthDate: string | null; phone: string | null; city: string | null; email: string | null };
  dentist: Dentist;
  phases: ProposalPhase[];
  scenarios: Scenario[];
  chosenScenario: Scenario | null;
  actionPlan: ActionPlanSummary;
  payments: ProposalPayment[];
  clinic: Pick<Clinic, "name" | "city" | "state" | "phone" | "email" | "logoUrl" | "primaryColor" | "secondaryColor">;
}

export interface ProposalCard {
  id: string;
  externalId?: string | null;
  title: string;
  stage: Stage;
  stageChangedAt: string;
  createdAt: string;
  presentedAt: string | null;
  total: number;
  paymentMethod: PaymentMethod | null;
  installments: number | null;
  lostReason: string | null;
  actionPlan?: ActionPlanSummary;
  /** Motivo de recusa mais citado entre os itens (ou o motivo da perda). */
  declineReason?: string | null;
  patient: { id: string; name: string };
  dentist: { id: string; name: string; color: string };
}

export interface RiskRow {
  patient: { id: string; name: string; phone: string | null; city: string | null; age: number | null };
  score: number;
  reasons: string[];
  stalledValue: number;
  breakdown: { monthsAway: number; pendingTreatment: number; recallOverdue: number; noShow: number };
  lastVisitAt: string | null;
  monthsSinceLastVisit: number | null;
  pendingTreatments: { name: string; value: number; phaseName: string; proposalId: string }[];
  openProposals: { id: string; title: string; total: number; stage: string }[];
  dentistName: string | null;
}

export interface DentistPerformance {
  dentistId: string;
  name: string;
  color: string;
  proposalsCreated: number;
  createdValue: number;
  acceptedProposals: number;
  acceptedValue: number;
  paidValue: number;
  avgTicket: number;
  acceptanceRate: number | null;
  openValue: number;
  openCount: number;
}

export interface Dashboard {
  periodDays: number;
  kpis: {
    proposalsCreated: { value: number; previous: number };
    acceptanceRate: { value: number | null; previous: number | null; decided: number };
    avgTicket: { value: number; previous: number };
    acceptedValue: number;
    patientsAtRisk: { value: number; stalledValue: number };
  };
  revenueByCategory: Record<Category, number>;
  dentists: DentistPerformance[];
  funnel: { stage: Stage; count: number; value: number }[];
  months: { key: string; label: string; created: number; accepted: number; value: number }[];
  followUps: { id: string; patient: string; dentist: string; total: number; days: number }[];
}

export interface PriceBand { label: string; min: number; max: number | null; count: number; accepted: number; acceptanceRate: number | null; avgPrice: number }
export interface Pricing {
  totals: { items: number; proposals: number; decided: number };
  highlights: { kind: string; severity: "info" | "warning"; title: string; detail: string }[];
  bands: { procedureId: string; procedureName: string; category: Category; decided: number; bands: PriceBand[] }[];
  dentists: { dentistId: string; dentistName: string; proposals: number; accepted: number; acceptanceRate: number | null; avgTicket: number; avgDiscountPct: number }[];
  installments: InstallmentCell[];
  installmentsImplant: InstallmentCell[];
  clareamentoSplit: { procedureName: string; threshold: number; below: { count: number; acceptanceRate: number | null }; above: { count: number; acceptanceRate: number | null } } | null;
}
export interface InstallmentCell { ticketBand: string; installmentsBand: string; count: number; accepted: number; acceptanceRate: number | null }

export const LOST_REASONS = ["Preço acima do esperado", "Vai pensar / sem retorno", "Fechou com outra clínica", "Sem condições financeiras no momento", "Priorizou outro tratamento", "Medo / adiou a decisão"];
