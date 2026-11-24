// Apaga as clínicas fictícias (externalId null = seed) e tudo que depende delas.
// As clínicas importadas do Clinicorp (externalId preenchido) ficam intactas.
//   npm run purge-seed -w server
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

async function main() {
  const seeds = await prisma.clinic.findMany({ where: { externalId: null }, select: { id: true, name: true } });
  if (seeds.length === 0) {
    console.log("Nenhuma clínica fictícia encontrada.");
    return;
  }
  for (const c of seeds) {
    const where = { clinicId: c.id };
    // Ordem explícita: Appointment→Dentist e ProposalItem→Procedure não têm cascade.
    const counts = {
      payments: (await prisma.payment.deleteMany({ where })).count,
      appointments: (await prisma.appointment.deleteMany({ where })).count,
      proposals: (await prisma.proposal.deleteMany({ where })).count, // cascata: fases, itens, eventos
      patients: (await prisma.patient.deleteMany({ where })).count,
      procedures: (await prisma.procedure.deleteMany({ where })).count,
      dentists: (await prisma.dentist.deleteMany({ where })).count,
      syncLogs: (await prisma.syncLog.deleteMany({ where })).count,
    };
    await prisma.clinic.delete({ where: { id: c.id } }); // cascata: settings, taxas de cartão
    console.log(`Apagada "${c.name}" (${c.id}):`, counts);
  }
  const left = await prisma.clinic.findMany({ select: { name: true, externalId: true } });
  console.log("Clínicas restantes:", left.map((c) => `${c.name} [${c.externalId}]`).join(", ") || "nenhuma");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
