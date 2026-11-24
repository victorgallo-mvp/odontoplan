// Mapeamento puro (sem rede, sem banco) dos payloads da API REST do Clinicorp
// (api.clinicorp.com/rest/v1, Swagger em sistema.clinicorp.com/api-docs) para
// os DTOs de ./types.ts. Tudo aqui é determinístico e coberto por testes.
//
// Fatos da API que moldam este arquivo (verificados contra uma conta real):
//  • Não existe "listar pacientes": pacientes são derivados de orçamentos,
//    agenda e pagamentos.
//  • /procedures/list devolve o catálogo SEM preço e com ids que não batem com
//    os dos orçamentos. O id estável de procedimento é Procedure_CharacteristicId
//    (em ProcedureList); o preço de tabela vem de `Amount`/`OriginalAmount`.
//  • /estimates/list: `id` muda conforme o status (plano de pagamento quando
//    aprovado); `TreatmentId` é estável → é o nosso externalId.
//  • /appointment/list: `date` vem em UTC mas não representa o horário real;
//    o horário correto é AtomicDate (YYYYMMDD) + fromTime/toTime no fuso da clínica.
//  • Flags booleanas são "X" (verdadeiro) ou "" / ausente (falso).

import type {
  ClinicorpAppointment,
  ClinicorpClinic,
  ClinicorpDentist,
  ClinicorpEstimate,
  ClinicorpEstimateItem,
  ClinicorpPatient,
  ClinicorpPayment,
  ClinicorpProcedure,
} from "./types.js";

// ── Payloads brutos (só os campos que usamos) ────────────────────────────────

export interface RawBusiness {
  id: number;
  CompanyId?: string | number;
  BusinessName?: string;
  Name?: string;
  Address?: string;
  Email?: string;
}

export interface RawProfessional {
  id: number;
  name: string;
  cpf?: string;
}

export interface RawStatus {
  id: number;
  Type: string; // CONFIRMED | ARRIVED | IN_SESSION | CHECKOUT | LATE | CALL | PENDING_MATERIAL | MISSED
  Description?: string;
  Active?: string;
}

export interface RawAppointment {
  ItemType?: "APPOINTMENT" | "EVENT" | "ASSIGN";
  id: number;
  date?: string;
  AtomicDate?: number;
  fromTime?: string;
  toTime?: string;
  Clinic_BusinessId?: number;
  Dentist_PersonId?: number;
  Patient_PersonId?: number;
  PatientName?: string;
  MobilePhone?: string;
  Email?: string;
  StatusId?: number;
  Canceled?: string;
  Deleted?: string;
  CategoryDescription?: string;
  Procedures?: string;
  CreateDate?: string;
}

export interface RawEstimateItem {
  id: number;
  TreatmentId: number;
  Procedure_CharacteristicId: number;
  OperationDescription?: string;
  Tooth?: string;
  Amount?: number; // valor de tabela
  OriginalAmount?: number;
  FinalAmount?: number; // valor com desconto
  Dentist_PersonId?: number;
  CreateDate?: string;
  Executed?: string;
  NotApproved?: string;
  Deleted?: string;
}

export interface RawEstimate {
  id: number;
  TreatmentId: number;
  Status: "OPEN" | "APPROVED" | "REJECTED" | "REJECTED_OPPORTUNITY" | "FOLLOWUP";
  CreateDate: string;
  Date?: string;
  ApprovedDate?: string;
  RejectedDate?: string;
  Amount: number;
  DiscountAmount?: number;
  BusinessId?: number;
  ProfessionalId?: number; // -1 quando não informado
  ProfessionalName?: string;
  PatientId: number;
  PatientName?: string;
  PatientMobilePhone?: string;
  ProcedureList?: RawEstimateItem[];
}

export interface RawPayment {
  id: number;
  TreatmentId?: number;
  PatientId: number;
  PatientName?: string;
  Amount: number;
  PaymentForm?: string; // "Cartão de Crédito" | "Boleto" | "Pix" | "Dinheiro" ...
  Type?: string;
  InstallmentNumber?: number;
  InstallmentsCount?: number;
  DueDate?: string;
  PostDate?: string;
  ReceivedDate?: string;
  PaymentReceived?: string;
  PaymentConfirmed?: string;
  Canceled?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const flag = (v: unknown): boolean => typeof v === "string" && v.trim().toUpperCase() === "X";
const str = (n: number | string | undefined | null) => (n === undefined || n === null ? "" : String(n));

/** "Rua X, 144 - Centro, Oliveira - MG" → { city: "Oliveira", state: "MG" } */
export function cityStateFromAddress(address?: string): { city?: string; state?: string } {
  if (!address) return {};
  const tail = address.split(",").pop()?.trim() ?? "";
  const m = tail.match(/^(.*?)\s*[-–/]\s*([A-Z]{2})$/);
  if (!m) return {};
  return { city: m[1].trim() || undefined, state: m[2] };
}

/** AtomicDate 20261027 + "16:30" + "-03:00" → Date em UTC. */
export function localDateTime(atomicDate: number, hhmm: string | undefined, tzOffset: string): Date {
  const s = String(atomicDate).padStart(8, "0");
  const time = /^\d{2}:\d{2}$/.test(hhmm ?? "") ? hhmm! : "00:00";
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${time}:00${tzOffset}`);
}

export function minutesBetween(from?: string, to?: string): number | undefined {
  const parse = (v?: string) => {
    const m = v?.match(/^(\d{2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
  };
  const a = parse(from);
  const b = parse(to);
  if (a === undefined || b === undefined || b <= a) return undefined;
  return b - a;
}

// ── Clínica / profissionais ──────────────────────────────────────────────────

export function mapClinic(b: RawBusiness): ClinicorpClinic {
  return {
    id: str(b.id),
    name: b.Name?.trim() || b.BusinessName?.trim() || `Clínica ${b.id}`,
    legalName: b.BusinessName?.trim() || undefined,
    address: b.Address?.trim() || undefined,
    email: b.Email?.trim() || undefined,
    ...cityStateFromAddress(b.Address),
  };
}

export function mapDentist(p: RawProfessional): ClinicorpDentist {
  return { id: str(p.id), name: p.name.trim(), active: true };
}

// ── Agenda ───────────────────────────────────────────────────────────────────

export type StatusTypeById = Map<string, string>; // StatusId → Type

/** Tipo da consulta a partir da categoria/procedimentos do agendamento (texto livre). */
export function appointmentType(a: RawAppointment): ClinicorpAppointment["type"] {
  const text = `${a.CategoryDescription ?? ""} ${a.Procedures ?? ""}`.toLowerCase();
  if (/avalia|consulta|primeira/.test(text)) return "avaliacao";
  if (/revis|retorno|manuten|controle/.test(text)) return "revisao";
  return "procedimento";
}

export function appointmentStatus(a: RawAppointment, statusTypes: StatusTypeById, start: Date, now: Date): ClinicorpAppointment["status"] {
  if (flag(a.Canceled) || flag(a.Deleted)) return "cancelada";
  const type = a.StatusId !== undefined ? statusTypes.get(str(a.StatusId)) : undefined;
  switch (type) {
    case "MISSED":
      return "faltou";
    case "ARRIVED":
    case "IN_SESSION":
    case "CHECKOUT":
    case "PENDING_MATERIAL":
      return "realizada";
    default:
      // Sem status registrado (o comum nesta conta): passado = realizada, futuro = agendada.
      return start.getTime() < now.getTime() ? "realizada" : "agendada";
  }
}

export function mapAppointment(
  a: RawAppointment,
  opts: { tzOffset: string; statusTypes: StatusTypeById; now: Date },
): ClinicorpAppointment | null {
  if (a.ItemType && a.ItemType !== "APPOINTMENT") return null;
  if (!a.Patient_PersonId || !a.Dentist_PersonId || !a.AtomicDate) return null;
  const start = localDateTime(a.AtomicDate, a.fromTime, opts.tzOffset);
  return {
    id: str(a.id),
    patientId: str(a.Patient_PersonId),
    dentistId: str(a.Dentist_PersonId),
    start: start.toISOString(),
    durationMin: minutesBetween(a.fromTime, a.toTime) ?? 60,
    type: appointmentType(a),
    status: appointmentStatus(a, opts.statusTypes, start, opts.now),
  };
}

// ── Orçamentos ───────────────────────────────────────────────────────────────

export function estimateStatus(s: RawEstimate["Status"]): ClinicorpEstimate["status"] {
  if (s === "APPROVED") return "aprovado";
  if (s === "REJECTED" || s === "REJECTED_OPPORTUNITY") return "recusado";
  return "pendente"; // OPEN, FOLLOWUP
}

export function liveItems(e: RawEstimate): RawEstimateItem[] {
  const items = (e.ProcedureList ?? []).filter((i) => !flag(i.Deleted));
  // Num orçamento aprovado, itens "NotApproved" ficaram de fora do fechamento.
  return e.Status === "APPROVED" ? items.filter((i) => !flag(i.NotApproved)) : items;
}

export function mapEstimate(e: RawEstimate): ClinicorpEstimate | null {
  const items = liveItems(e);
  const dentistId =
    e.ProfessionalId && e.ProfessionalId > 0 ? str(e.ProfessionalId) : str(items.find((i) => i.Dentist_PersonId)?.Dentist_PersonId);
  if (!dentistId || !e.PatientId) return null;
  const status = estimateStatus(e.Status);
  const decidedAt = status === "aprovado" ? e.ApprovedDate : status === "recusado" ? (e.RejectedDate ?? e.Date) : undefined;
  const mapped: ClinicorpEstimateItem[] = items.map((i) => ({
    procedureId: str(i.Procedure_CharacteristicId),
    description: i.OperationDescription?.trim() || "Procedimento",
    quantity: 1,
    unitPrice: i.FinalAmount ?? i.Amount ?? 0,
    tooth: i.Tooth?.trim() || undefined,
  }));
  return {
    id: str(e.TreatmentId),
    patientId: str(e.PatientId),
    dentistId,
    createdAt: e.CreateDate,
    decidedAt: decidedAt ?? undefined,
    status,
    total: e.Amount,
    items: mapped,
  };
}

/** Um tratamento pode aparecer mais de uma vez (ex.: aprovado + alternativa descartada). Fica o "mais decidido". */
export function dedupeEstimates(rows: RawEstimate[]): RawEstimate[] {
  const rank: Record<RawEstimate["Status"], number> = { APPROVED: 3, REJECTED: 2, REJECTED_OPPORTUNITY: 2, FOLLOWUP: 1, OPEN: 0 };
  const byTreatment = new Map<number, RawEstimate>();
  for (const e of rows) {
    const cur = byTreatment.get(e.TreatmentId);
    if (!cur || rank[e.Status] > rank[cur.Status]) byTreatment.set(e.TreatmentId, e);
  }
  return [...byTreatment.values()];
}

// ── Procedimentos (derivados dos orçamentos) ─────────────────────────────────

export function proceduresFromEstimates(rows: RawEstimate[]): ClinicorpProcedure[] {
  const latest = new Map<number, { name: string; price: number; seenAt: string }>();
  for (const e of rows) {
    for (const i of e.ProcedureList ?? []) {
      if (flag(i.Deleted) || !i.Procedure_CharacteristicId) continue;
      const price = i.OriginalAmount ?? i.Amount ?? 0;
      const seenAt = i.CreateDate ?? e.CreateDate;
      const cur = latest.get(i.Procedure_CharacteristicId);
      if (!cur || seenAt > cur.seenAt) {
        latest.set(i.Procedure_CharacteristicId, { name: i.OperationDescription?.trim() || cur?.name || "Procedimento", price, seenAt });
      }
    }
  }
  return [...latest.entries()]
    .map(([id, v]) => ({ id: str(id), code: `CC-${id}`, name: v.name, price: v.price, active: true }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// ── Pacientes (derivados de orçamentos + agenda + pagamentos) ────────────────

export function patientsFrom(sources: { estimates: RawEstimate[]; appointments: RawAppointment[]; payments: RawPayment[] }): ClinicorpPatient[] {
  const acc = new Map<string, ClinicorpPatient>();
  const touch = (id: number | undefined, name: string | undefined, seenAt: string | undefined, extra: Partial<ClinicorpPatient> = {}) => {
    if (!id || !name?.trim()) return;
    const key = str(id);
    const cur = acc.get(key);
    const createdAt = seenAt && (!cur || seenAt < cur.createdAt) ? seenAt : (cur?.createdAt ?? new Date().toISOString());
    acc.set(key, {
      id: key,
      name: name.trim(),
      createdAt,
      phone: cur?.phone ?? extra.phone,
      email: cur?.email ?? extra.email,
    });
  };
  for (const e of sources.estimates) touch(e.PatientId, e.PatientName, e.CreateDate, { phone: e.PatientMobilePhone?.trim() || undefined });
  for (const a of sources.appointments) {
    if (a.ItemType && a.ItemType !== "APPOINTMENT") continue;
    touch(a.Patient_PersonId, a.PatientName, a.CreateDate, { phone: a.MobilePhone?.trim() || undefined, email: a.Email?.trim() || undefined });
  }
  for (const p of sources.payments) touch(p.PatientId, p.PatientName, p.PostDate);
  return [...acc.values()];
}

// ── Pagamentos ───────────────────────────────────────────────────────────────

export function paymentMethod(form?: string, type?: string): string {
  const t = `${form ?? ""} ${type ?? ""}`.toLowerCase();
  if (/cart|credit|debit/.test(t)) return "cartao";
  if (/boleto/.test(t)) return "boleto";
  if (/pix/.test(t)) return "pix";
  if (/dinheiro|cash/.test(t)) return "dinheiro";
  return form?.trim().toLowerCase() || "outro";
}

export function mapPayment(p: RawPayment, now: Date): ClinicorpPayment | null {
  if (!p.TreatmentId || !p.PatientId || flag(p.Canceled)) return null;
  const due = p.DueDate ?? p.PostDate;
  if (!due) return null;
  const paid = flag(p.PaymentReceived);
  const status: ClinicorpPayment["status"] = paid ? "pago" : new Date(due).getTime() < now.getTime() ? "atrasado" : "pendente";
  return {
    id: str(p.id),
    estimateId: str(p.TreatmentId),
    patientId: str(p.PatientId),
    amount: p.Amount,
    method: paymentMethod(p.PaymentForm, p.Type),
    installmentNumber: p.InstallmentNumber ?? 1,
    installmentsTotal: p.InstallmentsCount && p.InstallmentsCount > 0 ? p.InstallmentsCount : 1,
    dueDate: due,
    paidAt: paid ? (p.ReceivedDate ?? p.PostDate) : undefined,
    status,
  };
}
