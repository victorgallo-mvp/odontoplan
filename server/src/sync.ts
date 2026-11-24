// CLI: `npm run sync -- --days 30` — roda o SyncService fora do servidor.
// Com CLINICORP_API_USER/TOKEN no .env importa da API real; sem eles, usa o mock.
import "dotenv/config";
import { prisma } from "./lib/db.js";
import { createClinicorpClient, resolveSyncClinic, SyncService, RealClinicorpClient } from "./clinicorp/index.js";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

async function main() {
  const days = Math.min(365, Math.max(1, Number(arg("days", "30")) || 30));
  const fallback = await prisma.clinic.findFirst({ orderBy: { createdAt: "asc" } });
  const client = createClinicorpClient(prisma, fallback?.id ?? "");
  const clinicId = await resolveSyncClinic(prisma, client, fallback?.id ?? "");
  if (!clinicId) throw new Error("Nenhuma clínica encontrada. Rode `npm run seed` ou configure o Clinicorp.");
  const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  console.log(`Sync [${client.source}] → clínica "${clinic.name}" (${clinic.id}) · ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);

  const started = Date.now();
  const result = await new SyncService(prisma, client, clinicId).syncAll({ from, to });
  console.table(result);
  const requests = client instanceof RealClinicorpClient ? ` · ${client.requestCount} requisições à API` : "";
  console.log(`Concluído em ${((Date.now() - started) / 1000).toFixed(1)}s${requests}`);
}

main()
  .catch((err) => {
    console.error("Sync falhou:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
