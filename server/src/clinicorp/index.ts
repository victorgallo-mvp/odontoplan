import type { PrismaClient } from "@prisma/client";
import type { ClinicorpClient } from "./ClinicorpClient.js";
import { MockClinicorpClient } from "./MockClinicorpClient.js";
import { RealClinicorpClient } from "./RealClinicorpClient.js";
import { DEFAULT_CARD_FEES } from "../domain/payment.js";

/** true quando CLINICORP_API_USER + CLINICORP_API_TOKEN estão no .env. */
export function isClinicorpConfigured(): boolean {
  return !!(process.env.CLINICORP_API_USER && process.env.CLINICORP_API_TOKEN);
}

/**
 * Fábrica: com credenciais no .env usa o client real; sem elas, o mock (que lê
 * do próprio banco). Nada mais no sistema precisa saber qual é.
 */
export function createClinicorpClient(prisma: PrismaClient, clinicId: string): ClinicorpClient {
  if (isClinicorpConfigured()) {
    return new RealClinicorpClient({
      apiUser: process.env.CLINICORP_API_USER!,
      apiToken: process.env.CLINICORP_API_TOKEN!,
      subscriberId: process.env.CLINICORP_SUBSCRIBER_ID || undefined,
      baseUrl: process.env.CLINICORP_BASE_URL || undefined,
      tzOffset: process.env.CLINICORP_TZ_OFFSET || undefined,
      businessId: process.env.CLINICORP_BUSINESS_ID || undefined,
    });
  }
  return new MockClinicorpClient(prisma, clinicId);
}

/**
 * Resolve a clínica local que recebe o sync. Com o client real, garante que a
 * unidade do Clinicorp existe como `Clinic` (externalId = BusinessId), separada
 * da clínica do seed — os dados reais nunca se misturam com os fictícios.
 * Com o mock, devolve `fallbackClinicId` (a clínica do seed).
 */
export async function resolveSyncClinic(prisma: PrismaClient, client: ClinicorpClient, fallbackClinicId: string): Promise<string> {
  const remote = await client.getClinic();
  if (!remote) return fallbackClinicId;
  const data = {
    name: remote.name,
    city: remote.city ?? "",
    state: remote.state ?? "",
    email: remote.email ?? null,
  };
  const clinic = await prisma.clinic.upsert({
    where: { externalId: remote.id },
    update: data,
    create: {
      externalId: remote.id,
      ...data,
      settings: { create: {} },
      cardFeeTiers: { create: DEFAULT_CARD_FEES.map((t) => ({ installments: t.installments, feePct: t.feePct })) },
    },
  });
  return clinic.id;
}

export { SyncService } from "./SyncService.js";
export { RealClinicorpClient, ClinicorpHttpError } from "./RealClinicorpClient.js";
export type { ClinicorpClient } from "./ClinicorpClient.js";
