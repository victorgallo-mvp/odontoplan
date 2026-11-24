import type {
  ClinicorpAppointment,
  ClinicorpClinic,
  ClinicorpDentist,
  ClinicorpEstimate,
  ClinicorpPatient,
  ClinicorpPayment,
  ClinicorpProcedure,
  DateRange,
} from "./types.js";

/**
 * Contrato da integração com o Clinicorp.
 *
 * API real: REST em https://api.clinicorp.com/rest/v1, autenticação Basic
 * (usuário de API + token). Implementações:
 *   - MockClinicorpClient  → lê do próprio banco local (dados do seed).
 *   - RealClinicorpClient  → HTTP para a API.
 *
 * Todos os métodos recebem o período do sync: a API real não tem "listar
 * pacientes" nem preço no catálogo de procedimentos, então ambos são derivados
 * dos orçamentos/agenda/pagamentos do período. O mock ignora o período onde
 * não faz sentido.
 *
 * O resto do sistema NUNCA fala com este client diretamente — só o SyncService,
 * que materializa tudo nas tabelas locais.
 */
export interface ClinicorpClient {
  readonly source: "mock" | "clinicorp";
  /** Clínica (unidade) dona dos dados; null no mock (usa a clínica do seed). */
  getClinic(): Promise<ClinicorpClinic | null>;
  listDentists(range: DateRange): Promise<ClinicorpDentist[]>;
  listPatients(range: DateRange): Promise<ClinicorpPatient[]>;
  listProcedures(range: DateRange): Promise<ClinicorpProcedure[]>;
  listAppointments(range: DateRange): Promise<ClinicorpAppointment[]>;
  listEstimates(range: DateRange): Promise<ClinicorpEstimate[]>;
  listPayments(range: DateRange): Promise<ClinicorpPayment[]>;
}
