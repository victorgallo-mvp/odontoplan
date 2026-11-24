// ─────────────────────────────────────────────────────────────────────────────
// Seed determinístico da "Clínica Sorria Mais" (Oliveira/MG).
//
// Gera dados fictícios com padrões embutidos de propósito, para os módulos de
// análise terem o que mostrar:
//   • Clareamento converte muito melhor abaixo de R$ 1.200.
//   • Implante converte mal quando parcelado em menos de 6x.
//   • Dr. júnior desconta demais e converte menos que a Dra. sênior.
//   • ~60 pacientes sem consulta há > 8 meses (churn).
//   • ~25 pacientes com tratamento aprovado e fases pendentes.
//   • ~40 pacientes com revisão semestral vencida (6–8 meses).
//
// Todo cálculo monetário usa src/domain/payment.ts — o mesmo código da aplicação.
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient, type Prisma } from "@prisma/client";
import { fakerPT_BR as faker } from "@faker-js/faker";
import { ARCHETYPES, CITIES, LOST_REASONS, PROCEDURES, type Archetype, type ProcedureSeed } from "./seed-data.js";
import { DEFAULT_CARD_FEES, DEFAULT_PAYMENT_CONFIG, scenarioFromCondition } from "../src/domain/payment.js";
import { round2 } from "../src/domain/money.js";
import { acceptanceByDentist, acceptanceSplitAt, type PricedItem } from "../src/domain/pricing.js";
import { monthsBetween } from "../src/domain/churn.js";
import type { PaymentMethod, Stage } from "../src/domain/types.js";
import { fallbackProposalTexts } from "../src/ai/fallback.js";

process.env.DATABASE_URL ||= "file:./dev.db";
const prisma = new PrismaClient();
faker.seed(20261028);

// ── Helpers ──────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * DAY);
const monthsAgo = (m: number) => daysAgo(m * 30.4375);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const capToday = (d: Date) => (d > TODAY ? TODAY : d);
const rf = (min: number, max: number) => faker.number.float({ min, max });
const ri = (min: number, max: number) => faker.number.int({ min, max });
const pick = <T>(arr: readonly T[]): T => faker.helpers.arrayElement(arr);
const weighted = <T>(opts: { weight: number; value: T }[]): T => faker.helpers.weightedArrayElement(opts);
const chance = (p: number) => rf(0, 1) < p;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Aproximação de normal (soma de 3 uniformes). */
const normal = (mean: number, sd: number) => mean + sd * (rf(0, 1) + rf(0, 1) + rf(0, 1) - 1.5) * 2;
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const pad = (n: number, w = 4) => String(n).padStart(w, "0");

/** Leva a data para um dia útil em horário comercial. */
function businessDateTime(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  while (out.getDay() === 0 || out.getDay() === 6) out.setDate(out.getDate() - 1);
  out.setHours(ri(8, 17), chance(0.5) ? 0 : 30, 0, 0);
  return out;
}

const procByKey = new Map<string, ProcedureSeed>(PROCEDURES.map((p) => [p.key, p]));

const TEETH: Record<string, number[]> = {
  molar: [16, 17, 26, 27, 36, 37, 46, 47],
  premolar: [14, 15, 24, 25, 34, 35, 44, 45],
  anterior: [11, 12, 13, 21, 22, 23, 31, 32, 33, 41, 42, 43],
  anteriorSup: [13, 12, 11, 21, 22, 23],
  siso: [18, 28, 38, 48],
  any: [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 31, 32, 33, 34, 35, 36, 37, 41, 42, 43, 44, 45, 46, 47],
  deciduous: [54, 55, 64, 65, 74, 75, 84, 85],
  firstMolar: [16, 26, 36, 46],
};
function teethFor(key: string, qty: number, pediatric: boolean): string {
  let pool = TEETH.any;
  if (key === "endo_molar") pool = TEETH.molar;
  else if (key === "endo_pre") pool = TEETH.premolar;
  else if (key === "endo_incisivo") pool = TEETH.anterior;
  else if (key === "exo_siso") pool = TEETH.siso;
  else if (["lente", "faceta_porcelana", "faceta_resina"].includes(key)) pool = TEETH.anteriorSup;
  else if (key === "selante") pool = pediatric ? (chance(0.5) ? TEETH.firstMolar : TEETH.deciduous) : TEETH.firstMolar;
  else if (pediatric) pool = TEETH.deciduous;
  if (["lente", "faceta_porcelana", "faceta_resina"].includes(key)) return pool.slice(0, qty).join(", ");
  return faker.helpers.arrayElements(pool, Math.min(qty, pool.length)).join(", ");
}

// ── Dentistas ────────────────────────────────────────────────────────────────
interface DentistSeed {
  id: string;
  key: string;
  name: string;
  cro: string;
  specialty: string;
  color: string;
  discountMean: number;
  discountSd: number;
  discountMax: number;
  baseAccept: number;
}
const DENTISTS: DentistSeed[] = [
  { id: "seed-den-01", key: "helena", name: "Dra. Helena Castro", cro: "CRO-MG 28.431", specialty: "Clínica geral e reabilitação oral", color: "#0F766E", discountMean: 0.01, discountSd: 0.02, discountMax: 0.08, baseAccept: 0.66 },
  { id: "seed-den-02", key: "rafael", name: "Dr. Rafael Moreira", cro: "CRO-MG 61.207", specialty: "Clínica geral", color: "#D97706", discountMean: 0.14, discountSd: 0.06, discountMax: 0.3, baseAccept: 0.36 },
  { id: "seed-den-03", key: "camila", name: "Dra. Camila Nogueira", cro: "CRO-MG 44.918", specialty: "Dentística e estética", color: "#7C3AED", discountMean: 0.05, discountSd: 0.03, discountMax: 0.12, baseAccept: 0.62 },
];
const dentistByKey = new Map(DENTISTS.map((d) => [d.key, d]));

function pickDentist(arch: Archetype): DentistSeed {
  if (arch.aesthetic) return weighted([{ weight: 70, value: dentistByKey.get("camila")! }, { weight: 20, value: dentistByKey.get("helena")! }, { weight: 10, value: dentistByKey.get("rafael")! }]);
  if (arch.pediatric) return weighted([{ weight: 60, value: dentistByKey.get("rafael")! }, { weight: 30, value: dentistByKey.get("helena")! }, { weight: 10, value: dentistByKey.get("camila")! }]);
  return weighted([{ weight: 42, value: dentistByKey.get("helena")! }, { weight: 43, value: dentistByKey.get("rafael")! }, { weight: 15, value: dentistByKey.get("camila")! }]);
}

// ── Pacientes e linha do tempo ───────────────────────────────────────────────
type Cohort = "churn" | "pending" | "recall" | "active";
interface Visit {
  date: Date;
  type: "avaliacao" | "procedimento" | "revisao";
  status: "agendada" | "realizada" | "faltou" | "cancelada";
  proposalId: string | null;
  dentistId: string;
}
interface PatientSeed {
  id: string;
  idx: number;
  cohort: Cohort;
  forcedPending: boolean; // precisa ter tratamento aprovado e não concluído
  name: string;
  firstName: string;
  gender: "F" | "M";
  birthDate: Date;
  age: number;
  phone: string;
  email: string | null;
  city: string;
  createdAt: Date;
  primaryDentist: DentistSeed;
  visits: Visit[]; // realizadas (ordem crescente)
  extra: Visit[]; // faltou / cancelada / agendada
}

const N_PATIENTS = 300;
const N_PROPOSALS = 350;
const CLAREAMENTO_PRICES = [790, 850, 950, 990, 1050, 1100, 1150, 1190, 1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600, 1700, 1800, 1900];

function cohortFor(idx: number): Cohort {
  if (idx < 60) return "churn";
  if (idx < 75) return "pending";
  if (idx < 115) return "recall";
  return "active";
}

function drawAge(minAge = 0): number {
  for (;;) {
    const bucket = weighted([
      { weight: 8, value: [3, 12] },
      { weight: 8, value: [13, 19] },
      { weight: 28, value: [20, 34] },
      { weight: 28, value: [35, 49] },
      { weight: 18, value: [50, 64] },
      { weight: 10, value: [65, 84] },
    ]);
    const age = ri(bucket[0], bucket[1]);
    if (age >= minAge) return age;
  }
}

function buildPatient(idx: number): PatientSeed {
  const cohort = cohortFor(idx);
  const forcedPending = cohort === "pending" || (cohort === "churn" && idx < 10);
  const gender: "F" | "M" = chance(0.58) ? "F" : "M";
  const sex = gender === "F" ? "female" : "male";
  const firstName = faker.person.firstName(sex);
  const name = `${firstName} ${faker.person.lastName()}${chance(0.5) ? " " + faker.person.lastName() : ""}`;
  const age = drawAge(forcedPending ? 14 : 0);
  const birthDate = addDays(TODAY, -(age * 365.25 + ri(0, 364)));
  const city = weighted(CITIES.map((c) => ({ weight: c.weight, value: c.name })));
  const primaryDentist = weighted([{ weight: 40, value: DENTISTS[0] }, { weight: 35, value: DENTISTS[1] }, { weight: 25, value: DENTISTS[2] }]);

  // Última consulta realizada, por coorte
  const lastVisitMonths =
    cohort === "churn" ? rf(8.5, 17) : cohort === "pending" ? rf(3, 7) : cohort === "recall" ? rf(6.2, 8) : rf(0.1, 5.5);
  const nVisits = weighted([
    { weight: 22, value: 1 },
    { weight: 30, value: 2 },
    { weight: 24, value: 3 },
    { weight: 14, value: 4 },
    { weight: 7, value: 5 },
    { weight: 3, value: 6 },
  ]);
  const horizon = monthsAgo(18);
  const dates: Date[] = [monthsAgo(lastVisitMonths)];
  for (let k = 1; k < nVisits; k++) {
    const prev = addDays(dates[0], -rf(10, 80));
    if (prev < horizon) break;
    dates.unshift(prev);
  }
  const visits: Visit[] = dates.map((d, i) => {
    let type: Visit["type"] = "procedimento";
    if (i === 0) type = "avaliacao";
    else if (i === dates.length - 1 && dates.length >= 3 && chance(0.5)) type = "revisao";
    else if (i === dates.length - 1 && dates.length === 2 && chance(0.25)) type = "revisao";
    else if (chance(0.1)) type = "avaliacao";
    return { date: businessDateTime(d), type, status: "realizada", proposalId: null, dentistId: primaryDentist.id };
  });

  // Faltas, cancelamentos e agendamentos futuros
  const extra: Visit[] = [];
  const first = visits[0].date;
  const last = visits[visits.length - 1].date;
  const randomBetween = (a: Date, b: Date) => businessDateTime(new Date(a.getTime() + rf(0, Math.max(1, b.getTime() - a.getTime()))));
  const prone = chance(0.2);
  const nFaltou = prone ? (chance(0.7) ? 1 : 2) : chance(0.08) ? 1 : 0;
  for (let k = 0; k < nFaltou; k++) {
    extra.push({ date: randomBetween(first, last), type: "procedimento", status: "faltou", proposalId: null, dentistId: primaryDentist.id });
  }
  if (cohort === "churn" && chance(0.4)) {
    // faltou depois da última consulta — sinal forte de abandono
    extra.push({ date: businessDateTime(addDays(last, ri(14, 60))), type: chance(0.5) ? "revisao" : "procedimento", status: "faltou", proposalId: null, dentistId: primaryDentist.id });
  }
  if (chance(0.1)) {
    extra.push({ date: randomBetween(first, last), type: "procedimento", status: "cancelada", proposalId: null, dentistId: primaryDentist.id });
  }
  if (cohort === "active" && chance(0.4)) {
    extra.push({ date: businessDateTime(addDays(TODAY, ri(1, 30))), type: chance(0.5) ? "revisao" : "procedimento", status: "agendada", proposalId: null, dentistId: primaryDentist.id });
  }

  const ddd = city === "Divinópolis" || city === "Formiga" || city === "Itapecerica" || city === "Cláudio" ? "37" : "37";
  return {
    id: `seed-pat-${pad(idx + 1)}`,
    idx,
    cohort,
    forcedPending,
    name,
    firstName,
    gender,
    birthDate,
    age,
    phone: `(${ddd}) 9${faker.string.numeric(4)}-${faker.string.numeric(4)}`,
    email: chance(0.6) ? faker.internet.email({ firstName, lastName: name.split(" ")[1] }).toLowerCase() : null,
    city,
    createdAt: addDays(first, -ri(0, 10)),
    primaryDentist,
    visits,
    extra,
  };
}

// ── Propostas ────────────────────────────────────────────────────────────────
interface ItemSeed {
  id: string;
  phaseId: string;
  procedure: ProcedureSeed;
  toothRegion: string | null;
  quantity: number;
  referencePrice: number;
  unitPrice: number;
  total: number;
}
interface PhaseSeed {
  id: string;
  order: number;
  name: string;
  status: "pendente" | "em_andamento" | "concluida";
  completedAt: Date | null;
  items: ItemSeed[];
}
interface ProposalSeed {
  id: string;
  patient: PatientSeed;
  dentist: DentistSeed;
  archetype: Archetype;
  title: string;
  stage: Stage;
  stageChangedAt: Date;
  createdAt: Date;
  presentedAt: Date | null;
  decidedAt: Date | null;
  validUntil: Date;
  lostReason: string | null;
  referenceTotal: number;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  installments: number;
  downPayment: number;
  installmentValue: number;
  finalAmount: number;
  phases: PhaseSeed[];
  events: { toStage: Stage; changedAt: Date }[];
  hasImplant: boolean;
}

let proposalSeq = 0;
let phaseSeq = 0;
let itemSeq = 0;

function pickArchetype(patient: PatientSeed, forced: boolean): Archetype {
  if (forced) {
    const multi = ARCHETYPES.filter((a) => a.multiPhase && !a.pediatric);
    return weighted(multi.map((a) => ({ weight: a.weight, value: a })));
  }
  if (patient.age < 13) {
    return chance(0.8) ? ARCHETYPES.find((a) => a.key === "infantil")! : ARCHETYPES.find((a) => a.key === "adequacao")!;
  }
  const adult = ARCHETYPES.filter((a) => !a.pediatric);
  return weighted(adult.map((a) => ({ weight: a.weight, value: a })));
}

function buildProposal(patient: PatientSeed, visitIdx: number, forced: boolean): ProposalSeed {
  const archetype = pickArchetype(patient, forced);
  const dentist = pickDentist(archetype);
  const createdAt = patient.visits[visitIdx].date;
  const ageDays = (TODAY.getTime() - createdAt.getTime()) / DAY;
  const pediatric = patient.age < 13;
  const id = `seed-prop-${pad(++proposalSeq)}`;

  // Desconto do dentista (sobre a tabela), com jitter por item
  const baseDiscount = clamp(normal(dentist.discountMean, dentist.discountSd), -0.03, dentist.discountMax);

  let clareamentoPrice: number | null = null;
  let hasImplant = false;
  const phases: PhaseSeed[] = archetype.phases.map((ph, i) => {
    const phaseId = `seed-phase-${pad(++phaseSeq)}`;
    const items: ItemSeed[] = [];
    for (const it of ph.items) {
      if (it.prob !== undefined && !chance(it.prob)) continue;
      const key = Array.isArray(it.key) ? pick(it.key) : it.key;
      const proc = procByKey.get(key)!;
      const quantity = Array.isArray(it.qty) ? ri(it.qty[0], it.qty[1]) : it.qty;
      let unitPrice: number;
      if (archetype.key === "clareamento_solo" && key === "clareamento") {
        unitPrice = pick(CLAREAMENTO_PRICES);
        clareamentoPrice = unitPrice;
      } else {
        const d = clamp(baseDiscount + rf(-0.015, 0.015), -0.05, 0.35);
        const step = proc.basePrice >= 1000 ? 50 : 10;
        unitPrice = Math.max(step, roundTo(proc.basePrice * (1 - d), step));
      }
      if (key === "implante") hasImplant = true;
      let toothRegion: string | null = null;
      if (it.region === "dente") toothRegion = teethFor(key, quantity, pediatric);
      else if (it.region === "quadrante") toothRegion = faker.helpers.arrayElements(["Q1", "Q2", "Q3", "Q4"], quantity).sort().join(", ");
      else if (it.region === "arcada") toothRegion = quantity === 2 ? "Superior e inferior" : pick(["Superior", "Inferior"]);
      items.push({ id: `seed-item-${pad(++itemSeq, 5)}`, phaseId, procedure: proc, toothRegion, quantity, referencePrice: proc.basePrice, unitPrice, total: round2(unitPrice * quantity) });
    }
    return { id: phaseId, order: i + 1, name: ph.name, status: "pendente", completedAt: null, items };
  });

  const allItems = phases.flatMap((p) => p.items);
  const referenceTotal = round2(allItems.reduce((s, i) => s + i.referencePrice * i.quantity, 0));
  const subtotal = round2(allItems.reduce((s, i) => s + i.total, 0));
  // Dr. júnior às vezes ainda dá um desconto "redondo" adicional
  const discount = dentist.key === "rafael" && chance(0.25) && subtotal > 600 ? Math.max(50, roundTo(subtotal * 0.05, 50)) : 0;
  const total = round2(subtotal - discount);

  // Condição de pagamento
  let paymentMethod: PaymentMethod;
  let installments: number;
  if (hasImplant) {
    if (!forced && chance(0.45)) {
      paymentMethod = weighted([{ weight: 40, value: "avista" as const }, { weight: 60, value: "cartao" as const }]);
      installments = paymentMethod === "avista" ? 1 : ri(2, 5);
    } else {
      paymentMethod = weighted([{ weight: 55, value: "cartao" as const }, { weight: 45, value: "boleto" as const }]);
      installments = paymentMethod === "cartao" ? pick([6, 8, 10, 12]) : pick([6, 8, 10]);
    }
  } else {
    paymentMethod = weighted([{ weight: 30, value: "avista" as const }, { weight: 45, value: "cartao" as const }, { weight: 25, value: "boleto" as const }]);
    if (paymentMethod === "avista") installments = 1;
    else if (paymentMethod === "cartao")
      installments = weighted([1, 2, 3, 4, 5, 6, 8, 10, 12].map((n, i) => ({ weight: [10, 8, 15, 10, 8, 15, 8, 16, 10][i], value: n })));
    else installments = weighted([2, 3, 4, 5, 6, 8, 10].map((n, i) => ({ weight: [10, 15, 15, 10, 20, 15, 15][i], value: n })));
  }
  const minDown = round2(total * (DEFAULT_PAYMENT_CONFIG.minDownPaymentPct / 100));
  const downPayment = paymentMethod === "boleto" ? Math.max(minDown, roundTo(total * rf(0.2, 0.35), 10)) : 0;
  const scenario = scenarioFromCondition(total, paymentMethod, installments, downPayment, DEFAULT_PAYMENT_CONFIG);

  // Decisão
  let pDecided = ageDays < 14 ? 0.15 : ageDays < 45 ? 0.3 : ageDays < 120 ? 0.45 : ageDays < 240 ? 0.8 : 0.97;
  if (clareamentoPrice !== null && ageDays >= 14) pDecided = 0.9; // decisão rápida: padrão de preço precisa de amostra
  const decided = forced || chance(pDecided);
  let accepted = false;
  if (decided) {
    let p = dentist.baseAccept;
    if (clareamentoPrice !== null) p = (clareamentoPrice < 1200 ? 0.55 : 0.22) + (dentist.baseAccept - 0.53) * 0.3;
    else if (hasImplant) p = (installments < 6 ? 0.25 : 0.62) + (dentist.baseAccept - 0.53) * 0.4;
    else {
      if (total > 10000) p -= 0.12;
      if (total < 500) p += 0.1;
    }
    accepted = forced || chance(clamp(p, 0.05, 0.95));
  }

  let stage: Stage;
  let presentedAt: Date | null = null;
  let decidedAt: Date | null = null;
  let stageChangedAt: Date;
  let lostReason: string | null = null;
  const events: { toStage: Stage; changedAt: Date }[] = [{ toStage: "planejamento", changedAt: createdAt }];

  if (decided) {
    presentedAt = capToday(addDays(createdAt, ri(0, 7)));
    decidedAt = capToday(addDays(presentedAt, ri(0, 14)));
    stage = accepted ? "aceita" : "perdida";
    stageChangedAt = decidedAt;
    if (!accepted) lostReason = pick(LOST_REASONS);
    events.push({ toStage: "revisada", changedAt: capToday(addDays(createdAt, rf(0.2, 1.5))) });
    events.push({ toStage: "apresentada", changedAt: presentedAt });
    if (chance(0.4)) events.push({ toStage: "negociacao", changedAt: new Date(presentedAt.getTime() + (decidedAt.getTime() - presentedAt.getTime()) * rf(0.2, 0.8)) });
    events.push({ toStage: stage, changedAt: decidedAt });
  } else {
    stage =
      ageDays < 14
        ? weighted([{ weight: 40, value: "planejamento" as Stage }, { weight: 30, value: "revisada" as Stage }, { weight: 25, value: "apresentada" as Stage }, { weight: 5, value: "negociacao" as Stage }])
        : ageDays < 60
          ? weighted([{ weight: 5, value: "planejamento" as Stage }, { weight: 10, value: "revisada" as Stage }, { weight: 50, value: "apresentada" as Stage }, { weight: 35, value: "negociacao" as Stage }])
          : weighted([{ weight: 45, value: "apresentada" as Stage }, { weight: 55, value: "negociacao" as Stage }]);
    if (stage === "planejamento") {
      stageChangedAt = createdAt;
    } else if (stage === "revisada") {
      stageChangedAt = capToday(addDays(createdAt, ri(0, 3)));
      events.push({ toStage: "revisada", changedAt: stageChangedAt });
    } else if (stage === "apresentada") {
      presentedAt = capToday(addDays(createdAt, ri(1, 10)));
      stageChangedAt = presentedAt;
      events.push({ toStage: "revisada", changedAt: capToday(addDays(createdAt, rf(0.2, 1.5))) });
      events.push({ toStage: "apresentada", changedAt: presentedAt });
    } else {
      presentedAt = capToday(addDays(createdAt, ri(1, 7)));
      stageChangedAt = capToday(addDays(presentedAt, ri(1, 10)));
      events.push({ toStage: "revisada", changedAt: capToday(addDays(createdAt, rf(0.2, 1.5))) });
      events.push({ toStage: "apresentada", changedAt: presentedAt });
      events.push({ toStage: "negociacao", changedAt: stageChangedAt });
    }
  }

  // Status das fases
  if (stage === "aceita" && decidedAt) {
    const sinceDecision = (TODAY.getTime() - decidedAt.getTime()) / DAY;
    if (forced) {
      phases[0].status = "concluida";
      phases[0].completedAt = capToday(addDays(decidedAt, ri(7, 30)));
      // demais fases ficam pendentes: tratamento parado
    } else if (sinceDecision > 120) {
      let cursor = decidedAt;
      for (const ph of phases) {
        cursor = capToday(addDays(cursor, ri(7, 40)));
        ph.status = "concluida";
        ph.completedAt = cursor;
      }
    } else if (phases.length === 1 && sinceDecision > 45) {
      phases[0].status = "concluida";
      phases[0].completedAt = capToday(addDays(decidedAt, ri(7, 40)));
    } else {
      phases[0].status = chance(0.6) ? "concluida" : "em_andamento";
      if (phases[0].status === "concluida") {
        phases[0].completedAt = capToday(addDays(decidedAt, ri(7, 30)));
        if (phases[1]) phases[1].status = "em_andamento";
      }
    }
    // Vincula consultas posteriores à decisão a esta proposta
    for (const v of patient.visits) {
      if (v.date > decidedAt && v.type === "procedimento" && !v.proposalId) {
        v.proposalId = id;
        v.dentistId = dentist.id;
      }
    }
  }
  // A avaliação que originou a proposta é feita pelo dentista da proposta
  patient.visits[visitIdx].dentistId = dentist.id;

  return {
    id,
    patient,
    dentist,
    archetype,
    title: archetype.title,
    stage,
    stageChangedAt,
    createdAt,
    presentedAt,
    decidedAt,
    validUntil: addDays(createdAt, 30),
    lostReason,
    referenceTotal,
    subtotal,
    discount,
    total,
    paymentMethod,
    installments,
    downPayment,
    installmentValue: scenario.installmentValue,
    finalAmount: scenario.total,
    phases,
    events,
    hasImplant,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🌱 Seed OdontoPlan — gerando dados fictícios determinísticos…");

  // Idempotente: apaga tudo (cascade a partir de clinics) e repopula.
  const existing = await prisma.clinic.count();
  if (existing > 0) {
    await prisma.clinic.deleteMany();
    console.log(`   (banco anterior limpo: ${existing} clínica(s) removida(s))`);
  }

  const clinic = await prisma.clinic.create({
    data: {
      id: "seed-clinic-01",
      name: "Clínica Sorria Mais",
      city: "Oliveira",
      state: "MG",
      phone: "(37) 3331-2040",
      email: "contato@sorriamais.com.br",
      logoUrl: null,
      primaryColor: "#0F766E",
      secondaryColor: "#134E4A",
      settings: { create: {} },
      cardFeeTiers: { create: DEFAULT_CARD_FEES.map((t) => ({ installments: t.installments, feePct: t.feePct })) },
    },
  });

  await prisma.dentist.createMany({
    data: DENTISTS.map((d, i) => ({ id: d.id, clinicId: clinic.id, externalId: `CC-DEN-${pad(i + 1, 3)}`, name: d.name, cro: d.cro, specialty: d.specialty, color: d.color })),
  });

  const procedureIdByKey = new Map<string, string>();
  await prisma.procedure.createMany({
    data: PROCEDURES.map((p, i) => {
      const id = `seed-proc-${pad(i + 1, 3)}`;
      procedureIdByKey.set(p.key, id);
      return { id, clinicId: clinic.id, externalId: `CC-PROC-${pad(i + 1, 3)}`, code: p.code, name: p.name, category: p.category, categoryConfirmed: true, basePrice: p.basePrice, durationMin: p.durationMin, description: p.description };
    }),
  });

  // Pacientes
  const patients: PatientSeed[] = [];
  for (let i = 0; i < N_PATIENTS; i++) patients.push(buildPatient(i));
  await prisma.patient.createMany({
    data: patients.map((p) => ({
      id: p.id, clinicId: clinic.id, externalId: `CC-PAT-${pad(p.idx + 1, 5)}`, name: p.name, birthDate: p.birthDate, gender: p.gender, phone: p.phone, email: p.email, city: p.city, state: "MG", createdAt: p.createdAt,
    })),
  });

  // Plano de propostas: quem recebe proposta e em qual visita
  const plan: { patient: PatientSeed; visitIdx: number; forced: boolean }[] = [];
  for (const p of patients) {
    if (p.forcedPending) plan.push({ patient: p, visitIdx: 0, forced: true });
    else if (chance(0.85)) plan.push({ patient: p, visitIdx: 0, forced: false });
    p.visits.forEach((v, i) => {
      if (i > 0 && v.type === "avaliacao" && chance(0.7)) plan.push({ patient: p, visitIdx: i, forced: false });
    });
    // Quem esteve na clínica nas últimas 2 semanas tem proposta "quente" em elaboração
    const lastIdx = p.visits.length - 1;
    if (lastIdx > 0 && (TODAY.getTime() - p.visits[lastIdx].date.getTime()) / DAY <= 14 && p.visits[lastIdx].type !== "avaliacao") {
      plan.push({ patient: p, visitIdx: lastIdx, forced: false });
    }
  }
  // Top-up até 350: metade em pacientes com consulta recente (alimenta as colunas iniciais do Kanban)
  const topUpPool = patients.filter((p) => p.cohort === "active" || p.cohort === "recall");
  const recentPool = patients.filter((p) => (TODAY.getTime() - p.visits[p.visits.length - 1].date.getTime()) / DAY <= 30);
  while (plan.length < N_PROPOSALS) {
    if (recentPool.length && chance(0.7)) {
      const p = pick(recentPool);
      plan.push({ patient: p, visitIdx: p.visits.length - 1, forced: false });
    } else {
      const p = pick(topUpPool);
      plan.push({ patient: p, visitIdx: ri(0, p.visits.length - 1), forced: false });
    }
  }
  plan.sort((a, b) => a.patient.visits[a.visitIdx].date.getTime() - b.patient.visits[b.visitIdx].date.getTime());

  const proposals: ProposalSeed[] = plan.slice(0, N_PROPOSALS).map((pl) => buildProposal(pl.patient, pl.visitIdx, pl.forced));

  // Textos de fallback (determinísticos) para a proposta já nascer apresentável
  const textsOf = new Map(
    proposals.map((p) => [
      p.id,
      fallbackProposalTexts({
        patientFirstName: p.patient.firstName,
        dentistName: p.dentist.name,
        clinicName: clinic.name,
        total: p.total,
        phases: p.phases.map((ph) => ({ name: ph.name, items: ph.items.map((it) => ({ name: it.procedure.name, quantity: it.quantity, category: it.procedure.category, description: it.procedure.description })) })),
      }),
    ]),
  );
  await prisma.proposal.createMany({
    data: proposals.map((p) => ({
      id: p.id, clinicId: clinic.id, externalId: `CC-EST-${p.id.slice(-4)}`, summaryText: textsOf.get(p.id)!.summary, benefitsText: textsOf.get(p.id)!.benefits, patientId: p.patient.id, dentistId: p.dentist.id, title: p.title, stage: p.stage, stageChangedAt: p.stageChangedAt, createdAt: p.createdAt, updatedAt: p.stageChangedAt, presentedAt: p.presentedAt, decidedAt: p.decidedAt, validUntil: p.validUntil, lostReason: p.lostReason, referenceTotal: p.referenceTotal, subtotal: p.subtotal, discount: p.discount, total: p.total, paymentMethod: p.paymentMethod, installments: p.installments, downPayment: p.downPayment, installmentValue: p.installmentValue, finalAmount: p.finalAmount,
    })),
  });
  await prisma.proposalPhase.createMany({
    data: proposals.flatMap((p) => p.phases.map((ph, i) => ({ id: ph.id, proposalId: p.id, order: ph.order, name: ph.name, description: textsOf.get(p.id)!.phases[i] ?? null, status: ph.status, completedAt: ph.completedAt }))),
  });
  await prisma.proposalItem.createMany({
    data: proposals.flatMap((p) => p.phases.flatMap((ph) => ph.items.map((it) => ({
      id: it.id, proposalId: p.id, phaseId: ph.id, procedureId: procedureIdByKey.get(it.procedure.key)!, description: it.procedure.name, toothRegion: it.toothRegion, quantity: it.quantity, referencePrice: it.referencePrice, unitPrice: it.unitPrice, total: it.total,
      decision: p.stage === "aceita" ? "aceito" : p.stage === "perdida" ? "recusado" : "pendente",
      declineReason: p.stage === "perdida" ? p.lostReason : null,
      decidedAt: p.stage === "aceita" || p.stage === "perdida" ? p.decidedAt : null,
    })))),
  });
  await prisma.proposalStageEvent.createMany({
    data: proposals.flatMap((p) => p.events.map((e, i) => ({ proposalId: p.id, fromStage: i === 0 ? null : p.events[i - 1].toStage, toStage: e.toStage, changedAt: e.changedAt }))),
  });

  // Consultas
  let apptSeq = 0;
  const appointmentRows = patients.flatMap((p) => [...p.visits, ...p.extra].map((v) => ({
    id: `seed-appt-${pad(++apptSeq)}`, clinicId: clinic.id, externalId: `CC-APT-${pad(apptSeq, 5)}`, patientId: p.id, dentistId: v.dentistId, proposalId: v.proposalId, scheduledAt: v.date, durationMin: v.type === "avaliacao" ? 30 : v.type === "revisao" ? 30 : pick([60, 60, 90]), type: v.type, status: v.status,
  })));
  await prisma.appointment.createMany({ data: appointmentRows });

  // Pagamentos (só propostas aceitas), coerentes com a condição escolhida
  let paySeq = 0;
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  for (const p of proposals) {
    if (p.stage !== "aceita" || !p.decidedAt) continue;
    const base = { clinicId: clinic.id, proposalId: p.id, patientId: p.patient.id };
    const statusFor = (due: Date, canBeLate: boolean) => {
      if (due > TODAY) return { status: "pendente", paidAt: null as Date | null };
      if (canBeLate && chance(0.12)) return { status: "atrasado", paidAt: null as Date | null };
      return { status: "pago", paidAt: capToday(addDays(due, ri(0, 3))) };
    };
    if (p.paymentMethod === "avista") {
      paymentRows.push({ ...base, id: `seed-pay-${pad(++paySeq)}`, externalId: `CC-PAY-${pad(paySeq, 5)}`, amount: p.finalAmount, method: "pix", installmentNumber: 1, installmentsTotal: 1, dueDate: p.decidedAt, ...statusFor(p.decidedAt, false) });
    } else {
      if (p.paymentMethod === "boleto") {
        paymentRows.push({ ...base, id: `seed-pay-${pad(++paySeq)}`, externalId: `CC-PAY-${pad(paySeq, 5)}`, amount: p.downPayment, method: "pix", installmentNumber: 0, installmentsTotal: p.installments, dueDate: p.decidedAt, ...statusFor(p.decidedAt, false) });
      }
      const financed = p.paymentMethod === "boleto" ? round2(p.total - p.downPayment) : p.finalAmount;
      for (let k = 1; k <= p.installments; k++) {
        const due = addDays(p.decidedAt, 30 * k);
        const amount = k === p.installments ? round2(financed - p.installmentValue * (p.installments - 1)) : p.installmentValue;
        paymentRows.push({ ...base, id: `seed-pay-${pad(++paySeq)}`, externalId: `CC-PAY-${pad(paySeq, 5)}`, amount, method: p.paymentMethod, installmentNumber: k, installmentsTotal: p.installments, dueDate: due, ...statusFor(due, p.paymentMethod === "boleto") });
      }
    }
  }
  await prisma.payment.createMany({ data: paymentRows });

  // ── Resumo / prova dos padrões ─────────────────────────────────────────────
  const allAppts = patients.flatMap((p) => [...p.visits, ...p.extra]);
  const count = (s: string) => allAppts.filter((a) => a.status === s).length;
  const byStage = (s: Stage) => proposals.filter((p) => p.stage === s).length;
  const decidedN = byStage("aceita") + byStage("perdida");
  const pendingN = proposals.length - decidedN;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

  const priced: PricedItem[] = proposals.flatMap((p) => p.phases.flatMap((ph) => ph.items.map((it) => ({
    procedureId: it.procedure.key, procedureName: it.procedure.name, category: it.procedure.category, dentistId: p.dentist.id, dentistName: p.dentist.name, unitPrice: it.unitPrice, referencePrice: it.referencePrice, quantity: it.quantity, accepted: p.stage === "aceita" ? true : p.stage === "perdida" ? false : null, installments: p.installments, proposalTotal: p.total, proposalId: p.id,
  }))));
  const clar = acceptanceSplitAt(priced, "clareamento", 1200);
  const impl = proposals.filter((p) => p.hasImplant && (p.stage === "aceita" || p.stage === "perdida"));
  const implShort = impl.filter((p) => p.installments < 6);
  const implLong = impl.filter((p) => p.installments >= 6);
  const acc = (l: ProposalSeed[]) => pct(l.filter((p) => p.stage === "aceita").length, l.length);

  const lastVisitMonths = (p: PatientSeed) => monthsBetween(p.visits[p.visits.length - 1].date, TODAY);
  const churnN = patients.filter((p) => lastVisitMonths(p) > 8).length;
  const recallN = patients.filter((p) => lastVisitMonths(p) > 6 && lastVisitMonths(p) <= 8).length;
  const pendingTreatmentPatients = new Set(proposals.filter((p) => p.stage === "aceita" && p.phases.some((ph) => ph.status !== "concluida")).map((p) => p.patient.id));
  const stalledPatients = new Set(proposals.filter((p) => p.stage === "aceita" && p.phases.some((ph) => ph.status === "pendente") && lastVisitMonths(p.patient) >= 3).map((p) => p.patient.id));
  const staleApresentada = proposals.filter((p) => p.stage === "apresentada" && (TODAY.getTime() - p.stageChangedAt.getTime()) / DAY > 7).length;

  console.log(`
Clínica:        ${clinic.name} (${clinic.city}/${clinic.state})
Dentistas:      ${DENTISTS.length}   Procedimentos: ${PROCEDURES.length}   Pacientes: ${patients.length}
Consultas:      ${allAppts.length}  (realizadas ${count("realizada")}, faltou ${count("faltou")} = ${pct(count("faltou"), count("realizada") + count("faltou"))} no-show, canceladas ${count("cancelada")}, agendadas ${count("agendada")})
Propostas:      ${proposals.length}  → aceitas ${byStage("aceita")} (${pct(byStage("aceita"), proposals.length)}), perdidas ${byStage("perdida")} (${pct(byStage("perdida"), proposals.length)}), pendentes ${pendingN} (${pct(pendingN, proposals.length)})
Kanban:         planejamento ${byStage("planejamento")} · revisada ${byStage("revisada")} · apresentada ${byStage("apresentada")} (${staleApresentada} há >7d) · negociação ${byStage("negociacao")} · aceita ${byStage("aceita")} · perdida ${byStage("perdida")}
Pagamentos:     ${paymentRows.length}

Padrões embutidos
  Clareamento   < R$ 1.200: ${pct(Math.round((clar.below.acceptanceRate ?? 0) * clar.below.count), clar.below.count)} de aceitação (n=${clar.below.count})  |  ≥ R$ 1.200: ${pct(Math.round((clar.above.acceptanceRate ?? 0) * clar.above.count), clar.above.count)} (n=${clar.above.count})
  Implante      < 6x: ${acc(implShort)} (n=${implShort.length})  |  ≥ 6x: ${acc(implLong)} (n=${implLong.length})
  Dentistas:`);
  for (const d of acceptanceByDentist(priced)) {
    console.log(`    ${d.dentistName.padEnd(22)} aceitação ${pct(d.accepted, d.proposals).padStart(4)}  desconto médio ${d.avgDiscountPct.toFixed(1).padStart(5)}%  ticket médio R$ ${d.avgTicket.toFixed(0)}`);
  }
  console.log(`
Risco / recall
  Sem consulta há > 8 meses:                 ${churnN}
  Revisão vencida (6–8 meses):               ${recallN}
  Tratamento aprovado não concluído:         ${pendingTreatmentPatients.size} pacientes (${stalledPatients.size} parados há ≥ 3 meses)
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
