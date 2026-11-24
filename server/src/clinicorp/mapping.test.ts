import { describe, expect, it } from "vitest";
import {
  appointmentStatus,
  cityStateFromAddress,
  dedupeEstimates,
  localDateTime,
  mapAppointment,
  mapClinic,
  mapEstimate,
  mapPayment,
  minutesBetween,
  patientsFrom,
  paymentMethod,
  proceduresFromEstimates,
  type RawAppointment,
  type RawEstimate,
  type RawPayment,
} from "./mapping.js";
import { RealClinicorpClient } from "./RealClinicorpClient.js";

// Fixtures sintéticas no formato real da API (ids/nomes fictícios).
const NOW = new Date("2026-11-06T12:00:00Z");

const estimateOpen: RawEstimate = {
  id: 100,
  TreatmentId: 100,
  Status: "OPEN",
  CreateDate: "2026-10-19T18:30:47.920Z",
  Date: "2026-10-19T18:30:47.920Z",
  Amount: 1950,
  BusinessId: 1,
  ProfessionalId: 11,
  ProfessionalName: "Dra. A",
  PatientId: 500,
  PatientName: "Paciente Um",
  PatientMobilePhone: "+5537999990000",
  ProcedureList: [
    { id: 1, TreatmentId: 100, Procedure_CharacteristicId: 9001, OperationDescription: "Restauração", Amount: 450, OriginalAmount: 450, FinalAmount: 450, Dentist_PersonId: 11, CreateDate: "2026-10-19T18:30:47.920Z", Tooth: "26" },
    { id: 2, TreatmentId: 100, Procedure_CharacteristicId: 9002, OperationDescription: "Profilaxia", Amount: 300, OriginalAmount: 300, FinalAmount: 300, Dentist_PersonId: 11, CreateDate: "2026-10-19T18:30:47.920Z" },
    { id: 3, TreatmentId: 100, Procedure_CharacteristicId: 9003, OperationDescription: "Excluído", Amount: 1200, FinalAmount: 1200, Dentist_PersonId: 11, Deleted: "X" },
  ],
};

const estimateApproved: RawEstimate = {
  id: 777, // id do plano de pagamento, não do tratamento
  TreatmentId: 200,
  Status: "APPROVED",
  CreateDate: "2026-10-03T15:17:13.000Z",
  ApprovedDate: "2026-10-06T16:59:37.000Z",
  Amount: 590,
  DiscountAmount: 70,
  ProfessionalId: -1, // não informado → usa o dentista do item
  PatientId: 501,
  PatientName: "Paciente Dois",
  ProcedureList: [
    { id: 4, TreatmentId: 200, Procedure_CharacteristicId: 9002, OperationDescription: "Profilaxia", Amount: 260, OriginalAmount: 260, FinalAmount: 260, Dentist_PersonId: 12, CreateDate: "2026-10-03T15:17:13.000Z" },
    { id: 5, TreatmentId: 200, Procedure_CharacteristicId: 9004, OperationDescription: "Clareamento", Amount: 400, OriginalAmount: 400, FinalAmount: 400, Dentist_PersonId: 12, CreateDate: "2026-10-03T15:17:13.000Z" },
    { id: 6, TreatmentId: 200, Procedure_CharacteristicId: 9005, OperationDescription: "Ficou de fora", Amount: 900, FinalAmount: 900, Dentist_PersonId: 12, NotApproved: "X" },
  ],
};

const appointment: RawAppointment = {
  ItemType: "APPOINTMENT",
  id: 300,
  date: "2026-10-27T05:00:00.000Z", // a API manda isto, mas o horário real é AtomicDate+fromTime
  AtomicDate: 20261027,
  fromTime: "16:30",
  toTime: "18:00",
  Dentist_PersonId: 11,
  Patient_PersonId: 502,
  PatientName: "Paciente Três",
  MobilePhone: "+5537998248525",
  Email: "tres@example.com",
  CategoryDescription: "Avaliação",
  CreateDate: "2026-10-22T19:52:11.611Z",
};

const payment: RawPayment = {
  id: 400,
  TreatmentId: 200,
  PatientId: 501,
  PatientName: "Paciente Dois",
  Amount: 200,
  PaymentForm: "Cartão de Crédito",
  Type: "CREDIT_CARD_POS",
  InstallmentNumber: 2,
  InstallmentsCount: 3,
  DueDate: "2026-10-06T06:00:00.000Z",
  PostDate: "2026-07-09T12:57:40.000Z",
  ReceivedDate: "2026-10-06T09:00:00.000Z",
  PaymentReceived: "X",
  PaymentConfirmed: "X",
};

describe("clínica", () => {
  it("extrai cidade/UF do endereço", () => {
    expect(cityStateFromAddress("Rua Francisco Cambraia Campos, 144 - Centro, Oliveira - MG")).toEqual({ city: "Oliveira", state: "MG" });
    expect(cityStateFromAddress("sem padrão")).toEqual({});
    expect(cityStateFromAddress(undefined)).toEqual({});
  });
  it("mapeia business/list", () => {
    const c = mapClinic({ id: 6579512043700224, BusinessName: "X LTDA", Name: "Clínica X", Address: "Rua A, 1 - Centro, Oliveira - MG", Email: "a@b.c" });
    expect(c).toMatchObject({ id: "6579512043700224", name: "Clínica X", legalName: "X LTDA", city: "Oliveira", state: "MG", email: "a@b.c" });
  });
});

describe("agenda", () => {
  it("monta o horário pelo AtomicDate + fromTime no fuso da clínica", () => {
    expect(localDateTime(20261027, "16:30", "-03:00").toISOString()).toBe("2026-10-27T19:30:00.000Z");
    expect(localDateTime(20261027, undefined, "-03:00").toISOString()).toBe("2026-10-27T03:00:00.000Z");
    expect(minutesBetween("16:30", "18:00")).toBe(90);
    expect(minutesBetween("18:00", "16:30")).toBeUndefined();
  });
  it("mapeia agendamento com tipo inferido e status por data quando não há StatusId", () => {
    const a = mapAppointment(appointment, { tzOffset: "-03:00", statusTypes: new Map(), now: NOW })!;
    expect(a).toMatchObject({ id: "300", patientId: "502", dentistId: "11", start: "2026-10-27T19:30:00.000Z", durationMin: 90, type: "avaliacao", status: "realizada" });
    const future = mapAppointment({ ...appointment, AtomicDate: 20261220 }, { tzOffset: "-03:00", statusTypes: new Map(), now: NOW })!;
    expect(future.status).toBe("agendada");
  });
  it("usa o status_list quando há StatusId; cancelado prevalece", () => {
    const types = new Map([["1", "MISSED"], ["2", "CHECKOUT"], ["3", "CONFIRMED"]]);
    const start = new Date("2026-12-01T12:00:00Z");
    expect(appointmentStatus({ ...appointment, StatusId: 1 }, types, start, NOW)).toBe("faltou");
    expect(appointmentStatus({ ...appointment, StatusId: 2 }, types, start, NOW)).toBe("realizada");
    expect(appointmentStatus({ ...appointment, StatusId: 3 }, types, start, NOW)).toBe("agendada");
    expect(appointmentStatus({ ...appointment, StatusId: 2, Canceled: "X" }, types, start, NOW)).toBe("cancelada");
  });
  it("ignora eventos/compromissos e itens sem paciente", () => {
    expect(mapAppointment({ ...appointment, ItemType: "ASSIGN" }, { tzOffset: "-03:00", statusTypes: new Map(), now: NOW })).toBeNull();
    expect(mapAppointment({ ...appointment, Patient_PersonId: undefined }, { tzOffset: "-03:00", statusTypes: new Map(), now: NOW })).toBeNull();
  });
});

describe("orçamentos", () => {
  it("usa TreatmentId como id, remove itens excluídos e mantém dente", () => {
    const e = mapEstimate(estimateOpen)!;
    expect(e.id).toBe("100");
    expect(e.status).toBe("pendente");
    expect(e.decidedAt).toBeUndefined();
    expect(e.items.map((i) => i.procedureId)).toEqual(["9001", "9002"]);
    expect(e.items[0]).toMatchObject({ description: "Restauração", unitPrice: 450, quantity: 1, tooth: "26" });
    expect(e.total).toBe(1950);
  });
  it("aprovado: tira itens NotApproved, usa ApprovedDate e dentista do item quando ProfessionalId = -1", () => {
    const e = mapEstimate(estimateApproved)!;
    expect(e).toMatchObject({ id: "200", status: "aprovado", decidedAt: "2026-10-06T16:59:37.000Z", dentistId: "12", total: 590 });
    expect(e.items).toHaveLength(2);
    // subtotal 660 vs total 590 → SyncService calcula desconto de 70
    expect(e.items.reduce((s, i) => s + i.unitPrice, 0)).toBe(660);
  });
  it("recusado e follow-up", () => {
    expect(mapEstimate({ ...estimateOpen, Status: "REJECTED", RejectedDate: "2026-10-20T00:00:00Z" })).toMatchObject({ status: "recusado", decidedAt: "2026-10-20T00:00:00Z" });
    expect(mapEstimate({ ...estimateOpen, Status: "REJECTED_OPPORTUNITY", Date: "2026-10-21T00:00:00Z" })).toMatchObject({ status: "recusado", decidedAt: "2026-10-21T00:00:00Z" });
    expect(mapEstimate({ ...estimateOpen, Status: "FOLLOWUP" })).toMatchObject({ status: "pendente" });
  });
  it("dedupe por TreatmentId fica com o status mais decidido", () => {
    const rows = dedupeEstimates([estimateOpen, { ...estimateOpen, id: 999, Status: "APPROVED", ApprovedDate: "2026-10-25T00:00:00Z" }, estimateApproved]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.TreatmentId === 100)?.Status).toBe("APPROVED");
  });
});

describe("procedimentos derivados dos orçamentos", () => {
  it("um por Procedure_CharacteristicId, com o preço de tabela mais recente", () => {
    const procs = proceduresFromEstimates([estimateApproved, estimateOpen]);
    expect(procs.map((p) => p.id).sort()).toEqual(["9001", "9002", "9004", "9005"]); // 9003 excluído fica fora
    const profilaxia = procs.find((p) => p.id === "9002")!;
    expect(profilaxia).toMatchObject({ name: "Profilaxia", price: 300, code: "CC-9002", active: true }); // 300 (19/10) é mais recente que 260 (03/10)
  });
});

describe("pacientes derivados", () => {
  it("une orçamentos, agenda e pagamentos sem duplicar e guarda telefone/e-mail", () => {
    const pats = patientsFrom({ estimates: [estimateOpen, estimateApproved], appointments: [appointment], payments: [payment] });
    expect(pats.map((p) => p.id).sort()).toEqual(["500", "501", "502"]);
    expect(pats.find((p) => p.id === "500")).toMatchObject({ name: "Paciente Um", phone: "+5537999990000", createdAt: "2026-10-19T18:30:47.920Z" });
    expect(pats.find((p) => p.id === "502")).toMatchObject({ phone: "+5537998248525", email: "tres@example.com" });
    // createdAt = primeira vez visto (pagamento lançado em julho)
    expect(pats.find((p) => p.id === "501")?.createdAt).toBe("2026-07-09T12:57:40.000Z");
  });
});

describe("pagamentos", () => {
  it("mapeia forma de pagamento", () => {
    expect(paymentMethod("Cartão de Crédito", "CREDIT_CARD_POS")).toBe("cartao");
    expect(paymentMethod("Boleto", "BOLETO_INTERNAL")).toBe("boleto");
    expect(paymentMethod("Pix", "PIX_EXTERNAL")).toBe("pix");
    expect(paymentMethod("Dinheiro", "OTHER")).toBe("dinheiro");
  });
  it("pago, atrasado, pendente; cancelado e sem tratamento ficam fora", () => {
    expect(mapPayment(payment, NOW)).toMatchObject({ id: "400", estimateId: "200", patientId: "501", amount: 200, method: "cartao", installmentNumber: 2, installmentsTotal: 3, status: "pago", paidAt: "2026-10-06T09:00:00.000Z" });
    const open = { ...payment, PaymentReceived: "", ReceivedDate: undefined };
    expect(mapPayment({ ...open, DueDate: "2026-10-01T06:00:00Z" }, NOW)?.status).toBe("atrasado");
    expect(mapPayment({ ...open, DueDate: "2026-12-01T06:00:00Z" }, NOW)?.status).toBe("pendente");
    expect(mapPayment({ ...payment, Canceled: "X" }, NOW)).toBeNull();
    expect(mapPayment({ ...payment, TreatmentId: undefined }, NOW)).toBeNull();
  });
});

describe("janelas de 31 dias", () => {
  it("quebra o período respeitando o limite do /estimates/list", () => {
    const w = RealClinicorpClient.windows({ from: new Date("2026-08-01T12:00:00Z"), to: new Date("2026-10-05T12:00:00Z") });
    expect(w).toEqual([
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-09-01", to: "2026-10-01" },
      { from: "2026-10-02", to: "2026-10-05" },
    ]);
    expect(RealClinicorpClient.windows({ from: new Date("2026-10-06T00:00:00Z"), to: new Date("2026-11-06T00:00:00Z") })).toHaveLength(2);
  });
});
