import { prisma } from "../lib/db.js";
import {
  acceptanceByDentist,
  acceptanceByInstallments,
  acceptanceByInstallmentsForProcedure,
  acceptanceByPriceBand,
  acceptanceSplitAt,
  buildHighlights,
  type PricedItem,
} from "../domain/pricing.js";

export async function loadPricedItems(clinicId: string): Promise<PricedItem[]> {
  const items = await prisma.proposalItem.findMany({
    where: { proposal: { clinicId } },
    include: {
      procedure: { select: { id: true, name: true, category: true } },
      proposal: { select: { id: true, stage: true, total: true, installments: true, dentist: { select: { id: true, name: true } } } },
    },
  });
  return items.map((it) => ({
    procedureId: it.procedure.id,
    procedureName: it.procedure.name,
    category: it.procedure.category,
    dentistId: it.proposal.dentist.id,
    dentistName: it.proposal.dentist.name,
    unitPrice: it.unitPrice,
    referencePrice: it.referencePrice,
    quantity: it.quantity,
    accepted: it.proposal.stage === "aceita" ? true : it.proposal.stage === "perdida" ? false : null,
    installments: it.proposal.installments ?? 1,
    proposalTotal: it.proposal.total,
    proposalId: it.proposal.id,
  }));
}

export async function buildPricingReport(clinicId: string) {
  const items = await loadPricedItems(clinicId);
  const clareamento = await prisma.procedure.findFirst({ where: { clinicId, code: "EST-001" } });
  const implante = await prisma.procedure.findFirst({ where: { clinicId, code: "FUN-001" } });
  const bands = acceptanceByPriceBand(items, 8);
  return {
    totals: {
      items: items.length,
      proposals: new Set(items.map((i) => i.proposalId)).size,
      decided: new Set(items.filter((i) => i.accepted !== null).map((i) => i.proposalId)).size,
    },
    highlights: buildHighlights(items),
    bands,
    dentists: acceptanceByDentist(items),
    installments: acceptanceByInstallments(items),
    installmentsImplant: implante ? acceptanceByInstallmentsForProcedure(items, implante.id) : [],
    clareamentoSplit: clareamento ? { procedureName: clareamento.name, ...acceptanceSplitAt(items, clareamento.id, 1200) } : null,
  };
}
