import { prisma } from "./db.js";
import type { PaymentConfig } from "../domain/payment.js";
import type { ChurnWeights } from "../domain/churn.js";
import { isClinicorpConfigured } from "../clinicorp/index.js";

/**
 * MVP single-clinic: toda rota usa UMA clínica, escolhida nesta ordem:
 *  1. CLINIC_ID no .env (id local);
 *  2. com Clinicorp configurado, a clínica importada (externalId preenchido);
 *  3. a primeira do banco (seed).
 * Quando houver multi-tenant real, isto vira resolução por sessão/host.
 */
export async function getDefaultClinic() {
  const include = { settings: true, cardFeeTiers: { orderBy: { installments: "asc" as const } } };
  const preferred = process.env.CLINIC_ID
    ? await prisma.clinic.findUnique({ where: { id: process.env.CLINIC_ID }, include })
    : isClinicorpConfigured()
      ? await prisma.clinic.findFirst({ where: { externalId: { not: null } }, include })
      : null;
  const clinic = preferred ?? (await prisma.clinic.findFirst({ include, orderBy: { createdAt: "asc" } }));
  if (!clinic || !clinic.settings) {
    throw new Error("Nenhuma clínica encontrada. Rode `npm run seed`.");
  }
  return clinic;
}

export type ClinicWithSettings = Awaited<ReturnType<typeof getDefaultClinic>>;

export function paymentConfigOf(clinic: ClinicWithSettings): PaymentConfig {
  const s = clinic.settings!;
  return {
    cashDiscountPct: s.cashDiscountPct,
    passCardFeeToPatient: s.passCardFeeToPatient,
    minDownPaymentPct: s.minDownPaymentPct,
    minDownPaymentMode: s.minDownPaymentMode === "fixed" ? "fixed" : "pct",
    minDownPaymentFixed: s.minDownPaymentFixed,
    maxOwnInstallments: s.maxOwnInstallments,
    cardFees: clinic.cardFeeTiers.map((t) => ({ installments: t.installments, feePct: t.feePct })),
  };
}

export function churnWeightsOf(clinic: ClinicWithSettings): ChurnWeights {
  const s = clinic.settings!;
  return {
    monthsAway: s.churnWeightMonthsAway,
    pendingTreatment: s.churnWeightPendingTreatment,
    recallOverdue: s.churnWeightRecallOverdue,
    noShow: s.churnWeightNoShow,
    monthsForMaxScore: s.churnMonthsForMaxScore,
    recallIntervalMonths: s.recallIntervalMonths,
  };
}
