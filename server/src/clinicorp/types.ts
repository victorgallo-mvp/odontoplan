// DTOs no formato (aproximado) da API REST do Clinicorp — api.clinicorp.com/rest/v1.
// Quando a integração real entrar, ajustar os campos aqui e no RealClinicorpClient;
// o resto do sistema só conhece as tabelas locais.

export interface DateRange {
  from: Date;
  to: Date;
}

export interface ClinicorpClinic {
  id: string; // BusinessId
  name: string;
  legalName?: string;
  address?: string;
  city?: string;
  state?: string;
  email?: string;
}

export interface ClinicorpDentist {
  id: string;
  name: string;
  cro?: string;
  specialty?: string;
  active?: boolean;
}

export interface ClinicorpPatient {
  id: string;
  name: string;
  birthDate?: string; // ISO date
  gender?: "F" | "M";
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  createdAt: string; // ISO datetime
}

export interface ClinicorpProcedure {
  id: string;
  code: string;
  name: string;
  price: number;
  durationMin?: number;
  active?: boolean;
}

export interface ClinicorpAppointment {
  id: string;
  patientId: string;
  dentistId: string;
  start: string; // ISO datetime
  durationMin: number;
  type: "avaliacao" | "procedimento" | "revisao";
  status: "agendada" | "realizada" | "faltou" | "cancelada";
  estimateId?: string;
}

export interface ClinicorpEstimateItem {
  procedureId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  tooth?: string;
}

export interface ClinicorpEstimate {
  id: string;
  patientId: string;
  dentistId: string;
  createdAt: string;
  decidedAt?: string;
  status: "aprovado" | "recusado" | "pendente";
  total: number;
  items: ClinicorpEstimateItem[];
  paymentCondition?: {
    method: "avista" | "cartao" | "boleto";
    installments: number;
    downPayment: number;
  };
}

export interface ClinicorpPayment {
  id: string;
  estimateId: string;
  patientId: string;
  amount: number;
  method: string;
  installmentNumber: number;
  installmentsTotal: number;
  dueDate: string;
  paidAt?: string;
  status: "pago" | "pendente" | "atrasado";
}
