import { describe, expect, it } from "vitest";
import {
  acceptanceByDentist,
  acceptanceByInstallments,
  acceptanceByPriceBand,
  acceptanceSplitAt,
  bandIndexFor,
  buildHighlights,
  buildQuartileBands,
  type PricedItem,
} from "./pricing.js";

let seq = 0;
function item(over: Partial<PricedItem>): PricedItem {
  seq++;
  return {
    procedureId: "clareamento",
    procedureName: "Clareamento de consultório",
    category: "estetico",
    dentistId: "d1",
    dentistName: "Dra. Helena",
    unitPrice: 1000,
    referencePrice: 1100,
    quantity: 1,
    accepted: true,
    installments: 1,
    proposalTotal: 1000,
    proposalId: `p${seq}`,
    ...over,
  };
}

/** 20 itens baratos (70% aceitos) + 20 caros (20% aceitos). */
function clareamentoDataset(): PricedItem[] {
  const items: PricedItem[] = [];
  for (let i = 0; i < 20; i++) items.push(item({ unitPrice: 900 + i * 10, accepted: i < 14 }));
  for (let i = 0; i < 20; i++) items.push(item({ unitPrice: 1300 + i * 20, accepted: i < 4 }));
  items.push(item({ unitPrice: 1000, accepted: null })); // pendente — deve ser ignorado
  return items;
}

describe("buildQuartileBands", () => {
  it("gera até 4 bandas contíguas e classifica preços", () => {
    const bands = buildQuartileBands([100, 200, 300, 400, 500, 600, 700, 800]);
    expect(bands.length).toBe(4);
    expect(bands[0].min).toBe(100);
    expect(bands[bands.length - 1].max).toBeNull();
    expect(bandIndexFor(100, bands)).toBe(0);
    expect(bandIndexFor(10000, bands)).toBe(3);
  });

  it("colapsa bandas quando há poucos preços distintos", () => {
    expect(buildQuartileBands([500, 500, 500]).length).toBe(1);
    expect(buildQuartileBands([500, 500, 900, 900]).length).toBe(2);
  });
});

describe("acceptanceByPriceBand", () => {
  it("mostra a aceitação caindo da banda barata para a cara", () => {
    const [rep] = acceptanceByPriceBand(clareamentoDataset());
    expect(rep.decided).toBe(40);
    const first = rep.bands[0];
    const last = rep.bands[rep.bands.length - 1];
    expect(first.acceptanceRate!).toBeGreaterThan(0.6);
    expect(last.acceptanceRate!).toBeLessThan(0.25);
    expect(rep.bands.reduce((s, b) => s + b.count, 0)).toBe(40);
  });

  it("ignora procedimentos com poucas decisões", () => {
    const few = [item({ procedureId: "x", accepted: true }), item({ procedureId: "x", accepted: false })];
    expect(acceptanceByPriceBand(few)).toEqual([]);
  });
});

describe("acceptanceSplitAt", () => {
  it("corta em R$ 1.200 e calcula taxas de cada lado", () => {
    const s = acceptanceSplitAt(clareamentoDataset(), "clareamento", 1200);
    expect(s.below).toEqual({ count: 20, acceptanceRate: 0.7 });
    expect(s.above).toEqual({ count: 20, acceptanceRate: 0.2 });
  });
});

describe("acceptanceByDentist", () => {
  it("calcula desconto médio ponderado e taxa de aceitação por dentista", () => {
    const items = [
      item({ dentistId: "a", dentistName: "A", unitPrice: 1000, referencePrice: 1000, accepted: true, proposalTotal: 1000 }),
      item({ dentistId: "a", dentistName: "A", unitPrice: 1000, referencePrice: 1000, accepted: false, proposalTotal: 1000 }),
      item({ dentistId: "b", dentistName: "B", unitPrice: 850, referencePrice: 1000, accepted: false, proposalTotal: 850 }),
      item({ dentistId: "b", dentistName: "B", unitPrice: 850, referencePrice: 1000, accepted: null, proposalTotal: 850 }),
    ];
    const [a, b] = acceptanceByDentist(items);
    expect(a.dentistId).toBe("a");
    expect(a.acceptanceRate).toBe(0.5);
    expect(a.avgDiscountPct).toBe(0);
    expect(b.avgDiscountPct).toBe(15);
    expect(b.proposals).toBe(1); // pendente não conta como decidida
    expect(b.avgTicket).toBe(850);
  });
});

describe("acceptanceByInstallments", () => {
  it("agrupa por faixa de ticket × parcelas no nível da proposta", () => {
    const items = [
      item({ proposalTotal: 3500, installments: 3, accepted: false }),
      item({ proposalTotal: 3500, installments: 10, accepted: true }),
      item({ proposalTotal: 3500, installments: 10, accepted: true }),
    ];
    const cells = acceptanceByInstallments(items);
    const short = cells.find((c) => c.ticketBand === "R$ 3.000 – 8.000" && c.installmentsBand === "2–5x")!;
    const long = cells.find((c) => c.ticketBand === "R$ 3.000 – 8.000" && c.installmentsBand === "6–10x")!;
    expect(short).toMatchObject({ count: 1, accepted: 0, acceptanceRate: 0 });
    expect(long).toMatchObject({ count: 2, accepted: 2, acceptanceRate: 1 });
  });
});

describe("buildHighlights", () => {
  it("gera destaque de faixa de preço para o padrão do clareamento", () => {
    const hl = buildHighlights(clareamentoDataset());
    const band = hl.find((h) => h.kind === "price_band");
    expect(band).toBeDefined();
    expect(band!.title).toMatch(/Clareamento de consultório: aceitação de \d+%/);
  });
});
