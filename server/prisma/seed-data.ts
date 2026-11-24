// Dados estáticos do seed: tabela de procedimentos e arquétipos de plano.
import type { Category } from "../src/domain/types.js";

export interface ProcedureSeed {
  key: string;
  code: string;
  name: string;
  category: Category;
  basePrice: number;
  durationMin: number;
  description: string;
}

export const PROCEDURES: ProcedureSeed[] = [
  // ── Clínico ───────────────────────────────────────────────────────────────
  { key: "avaliacao", code: "CLI-001", name: "Consulta de avaliação", category: "clinico", basePrice: 150, durationMin: 30, description: "Exame clínico completo para entender a situação atual da sua boca e planejar o tratamento." },
  { key: "profilaxia", code: "CLI-002", name: "Profilaxia (limpeza)", category: "clinico", basePrice: 180, durationMin: 45, description: "Remoção de placa e tártaro com polimento dos dentes, prevenindo cáries e doenças da gengiva." },
  { key: "raspagem", code: "CLI-003", name: "Raspagem periodontal (por quadrante)", category: "clinico", basePrice: 250, durationMin: 60, description: "Limpeza profunda abaixo da gengiva para tratar inflamação e evitar perda óssea." },
  { key: "fluor", code: "CLI-004", name: "Aplicação de flúor", category: "clinico", basePrice: 90, durationMin: 20, description: "Fortalece o esmalte e reduz a sensibilidade e o risco de cáries." },
  { key: "restauracao_1f", code: "CLI-005", name: "Restauração em resina (1 face)", category: "clinico", basePrice: 220, durationMin: 45, description: "Remoção da cárie e reconstrução do dente com resina da cor natural." },
  { key: "restauracao_2f", code: "CLI-006", name: "Restauração em resina (2 faces)", category: "clinico", basePrice: 300, durationMin: 60, description: "Restauração de cárie que atinge duas superfícies do dente, devolvendo forma e função." },
  { key: "restauracao_3f", code: "CLI-007", name: "Restauração em resina (3+ faces)", category: "clinico", basePrice: 380, durationMin: 75, description: "Reconstrução ampla do dente com resina, para cáries ou fraturas maiores." },
  { key: "endo_incisivo", code: "CLI-008", name: "Tratamento de canal — incisivo/canino", category: "clinico", basePrice: 650, durationMin: 90, description: "Remove a infecção de dentro do dente da frente e sela o canal, eliminando a dor e salvando o dente." },
  { key: "endo_pre", code: "CLI-009", name: "Tratamento de canal — pré-molar", category: "clinico", basePrice: 800, durationMin: 90, description: "Tratamento do canal de um pré-molar para eliminar infecção e preservar o dente." },
  { key: "endo_molar", code: "CLI-010", name: "Tratamento de canal — molar", category: "clinico", basePrice: 1100, durationMin: 120, description: "Tratamento dos canais de um molar (dente de trás), que tem mais raízes e exige mais tempo." },
  { key: "retratamento_endo", code: "CLI-011", name: "Retratamento de canal", category: "clinico", basePrice: 1400, durationMin: 120, description: "Refaz um tratamento de canal antigo que voltou a dar problema." },
  { key: "exo_simples", code: "CLI-012", name: "Extração simples", category: "clinico", basePrice: 300, durationMin: 45, description: "Remoção de um dente sem condições de ser recuperado." },
  { key: "exo_siso", code: "CLI-013", name: "Extração de siso incluso", category: "clinico", basePrice: 750, durationMin: 90, description: "Cirurgia para remover o dente do siso que não nasceu ou nasceu torto." },
  { key: "selante", code: "CLI-014", name: "Selante (por dente)", category: "clinico", basePrice: 120, durationMin: 20, description: "Película protetora nos sulcos dos dentes de trás, que evita cáries em crianças e adolescentes." },
  { key: "rx_periapical", code: "CLI-015", name: "Radiografia periapical", category: "clinico", basePrice: 50, durationMin: 10, description: "Raio-X de um dente e sua raiz, para diagnóstico preciso." },
  { key: "rx_panoramica", code: "CLI-016", name: "Radiografia panorâmica", category: "clinico", basePrice: 150, durationMin: 15, description: "Raio-X de toda a boca em uma única imagem." },
  { key: "tomografia", code: "CLI-017", name: "Tomografia cone beam", category: "clinico", basePrice: 450, durationMin: 20, description: "Exame 3D do osso, essencial para planejar implantes com segurança." },
  { key: "cirurgia_perio", code: "CLI-018", name: "Cirurgia periodontal", category: "clinico", basePrice: 1200, durationMin: 90, description: "Cirurgia na gengiva para tratar bolsas profundas e recuperar a saúde periodontal." },
  { key: "sensibilidade", code: "CLI-019", name: "Tratamento de sensibilidade", category: "clinico", basePrice: 200, durationMin: 30, description: "Aplicação de agentes dessensibilizantes para dentes que doem com frio ou doce." },
  { key: "urgencia", code: "CLI-020", name: "Atendimento de urgência (dor)", category: "clinico", basePrice: 200, durationMin: 40, description: "Alívio imediato da dor e medicação até o tratamento definitivo." },
  { key: "pulpotomia", code: "CLI-021", name: "Pulpotomia (dente de leite)", category: "clinico", basePrice: 350, durationMin: 60, description: "Tratamento da polpa de um dente de leite para mantê-lo até a troca natural." },
  { key: "frenectomia", code: "CLI-022", name: "Frenectomia", category: "clinico", basePrice: 800, durationMin: 45, description: "Pequena cirurgia no freio da língua ou do lábio." },
  { key: "drenagem", code: "CLI-023", name: "Drenagem de abscesso", category: "clinico", basePrice: 300, durationMin: 40, description: "Alívio de infecção com pus na gengiva ou face." },
  { key: "coroa_aco", code: "CLI-024", name: "Coroa de aço (dente de leite)", category: "clinico", basePrice: 400, durationMin: 60, description: "Proteção de um dente de leite muito destruído até a troca natural." },
  { key: "tartarectomia", code: "CLI-025", name: "Remoção de tártaro supragengival", category: "clinico", basePrice: 150, durationMin: 30, description: "Remoção do tártaro visível acima da gengiva." },

  // ── Funcional ─────────────────────────────────────────────────────────────
  { key: "implante", code: "FUN-001", name: "Implante dentário unitário", category: "funcional", basePrice: 3500, durationMin: 90, description: "Pino de titânio instalado no osso que substitui a raiz do dente perdido, base para uma coroa fixa." },
  { key: "enxerto", code: "FUN-002", name: "Enxerto ósseo", category: "funcional", basePrice: 1800, durationMin: 90, description: "Reposição de osso onde ele ficou fino demais para receber o implante." },
  { key: "seio_maxilar", code: "FUN-003", name: "Levantamento de seio maxilar", category: "funcional", basePrice: 2500, durationMin: 120, description: "Cirurgia que cria altura de osso na região de trás do maxilar superior para implantes." },
  { key: "coroa_implante", code: "FUN-004", name: "Coroa sobre implante", category: "funcional", basePrice: 2800, durationMin: 60, description: "Dente de cerâmica fixado sobre o implante, com aparência e função de um dente natural." },
  { key: "coroa_metaloceramica", code: "FUN-005", name: "Coroa metalocerâmica", category: "funcional", basePrice: 1600, durationMin: 60, description: "Coroa resistente com estrutura metálica e cobertura de porcelana." },
  { key: "coroa_zirconia", code: "FUN-006", name: "Coroa em zircônia", category: "funcional", basePrice: 2400, durationMin: 60, description: "Coroa totalmente cerâmica, muito resistente e sem metal aparente." },
  { key: "coroa_dissilicato", code: "FUN-007", name: "Coroa em dissilicato de lítio", category: "funcional", basePrice: 2200, durationMin: 60, description: "Coroa de porcelana pura, com excelente estética para dentes da frente." },
  { key: "pino", code: "FUN-008", name: "Pino de fibra de vidro", category: "funcional", basePrice: 400, durationMin: 45, description: "Reforço interno de um dente tratado com canal antes de receber a coroa." },
  { key: "protese_total", code: "FUN-009", name: "Prótese total (por arcada)", category: "funcional", basePrice: 2200, durationMin: 60, description: "Dentadura completa feita sob medida para devolver mastigação, fala e sorriso." },
  { key: "ppr", code: "FUN-010", name: "Prótese parcial removível", category: "funcional", basePrice: 1800, durationMin: 60, description: "Prótese que repõe vários dentes e pode ser retirada para higiene." },
  { key: "protocolo", code: "FUN-011", name: "Prótese protocolo sobre implantes", category: "funcional", basePrice: 18000, durationMin: 180, description: "Arcada completa de dentes fixos sobre 4 a 6 implantes." },
  { key: "overdenture", code: "FUN-012", name: "Overdenture sobre implantes", category: "funcional", basePrice: 9000, durationMin: 120, description: "Dentadura que se encaixa em implantes, com muito mais estabilidade." },
  { key: "aparelho_fixo", code: "FUN-013", name: "Aparelho ortodôntico fixo (instalação)", category: "funcional", basePrice: 1500, durationMin: 90, description: "Instalação do aparelho metálico para alinhar os dentes e corrigir a mordida." },
  { key: "manutencao_orto", code: "FUN-014", name: "Manutenção ortodôntica mensal", category: "funcional", basePrice: 180, durationMin: 30, description: "Ajuste mensal do aparelho." },
  { key: "aparelho_estetico", code: "FUN-015", name: "Aparelho ortodôntico estético (safira)", category: "funcional", basePrice: 2800, durationMin: 90, description: "Aparelho com peças transparentes, mais discreto." },
  { key: "alinhadores", code: "FUN-016", name: "Alinhadores invisíveis", category: "funcional", basePrice: 9500, durationMin: 60, description: "Placas transparentes removíveis que alinham os dentes sem aparelho fixo." },
  { key: "contencao", code: "FUN-017", name: "Contenção ortodôntica", category: "funcional", basePrice: 500, durationMin: 45, description: "Mantém os dentes na posição correta depois do aparelho." },
  { key: "placa_bruxismo", code: "FUN-018", name: "Placa de bruxismo", category: "funcional", basePrice: 600, durationMin: 45, description: "Placa de acrílico para uso noturno que protege os dentes do ranger." },
  { key: "ajuste_oclusal", code: "FUN-019", name: "Ajuste oclusal", category: "funcional", basePrice: 350, durationMin: 45, description: "Pequenos desgastes para equilibrar a mordida e aliviar dores." },
  { key: "onlay", code: "FUN-020", name: "Onlay/Inlay em cerâmica", category: "funcional", basePrice: 1500, durationMin: 75, description: "Restauração de cerâmica feita em laboratório para dentes muito destruídos." },

  // ── Estético ──────────────────────────────────────────────────────────────
  { key: "clareamento", code: "EST-001", name: "Clareamento de consultório", category: "estetico", basePrice: 1100, durationMin: 60, description: "Clareamento com gel de alta concentração aplicado pelo dentista, resultado em 1 a 2 sessões." },
  { key: "clareamento_caseiro", code: "EST-002", name: "Clareamento caseiro supervisionado", category: "estetico", basePrice: 700, durationMin: 30, description: "Moldeira personalizada e gel para usar em casa, com acompanhamento do dentista." },
  { key: "faceta_resina", code: "EST-003", name: "Faceta em resina", category: "estetico", basePrice: 600, durationMin: 60, description: "Camada de resina esculpida sobre o dente para corrigir cor, forma ou pequenos espaços." },
  { key: "lente", code: "EST-004", name: "Lente de contato dental (porcelana)", category: "estetico", basePrice: 2500, durationMin: 60, description: "Lâmina finíssima de porcelana colada sobre o dente, com desgaste mínimo." },
  { key: "faceta_porcelana", code: "EST-005", name: "Faceta em porcelana", category: "estetico", basePrice: 2200, durationMin: 60, description: "Faceta de porcelana para transformar cor e formato dos dentes da frente." },
  { key: "gengivoplastia", code: "EST-006", name: "Gengivoplastia estética", category: "estetico", basePrice: 900, durationMin: 60, description: "Remodelação do contorno da gengiva para harmonizar o sorriso (sorriso gengival)." },
  { key: "toxina", code: "EST-007", name: "Harmonização — toxina botulínica", category: "estetico", basePrice: 900, durationMin: 30, description: "Aplicação para suavizar linhas de expressão e sorriso gengival." },
  { key: "preenchimento", code: "EST-008", name: "Preenchimento labial", category: "estetico", basePrice: 1400, durationMin: 40, description: "Ácido hialurônico para contorno e volume dos lábios." },
  { key: "microabrasao", code: "EST-009", name: "Microabrasão do esmalte", category: "estetico", basePrice: 350, durationMin: 40, description: "Remoção de manchas brancas superficiais do esmalte." },
  { key: "recontorno", code: "EST-010", name: "Recontorno estético (por dente)", category: "estetico", basePrice: 250, durationMin: 30, description: "Pequenos ajustes de forma nas bordas dos dentes da frente." },
];

export type RegionKind = "dente" | "quadrante" | "arcada" | "none";

export interface ArchetypeItem {
  key: string | string[]; // string[] = escolhe um
  qty: number | [number, number];
  region?: RegionKind;
  prob?: number; // probabilidade de o item aparecer (default 1)
}

export interface Archetype {
  key: string;
  title: string;
  weight: number;
  aesthetic?: boolean; // tende para a Dra. especialista em estética
  pediatric?: boolean;
  multiPhase: boolean; // candidato a "tratamento aprovado e não concluído"
  phases: { name: string; items: ArchetypeItem[] }[];
}

export const ARCHETYPES: Archetype[] = [
  {
    key: "adequacao", title: "Adequação do meio bucal", weight: 18, multiPhase: false,
    phases: [{ name: "Adequação e restaurações", items: [
      { key: "profilaxia", qty: 1 },
      { key: "restauracao_1f", qty: [1, 2], region: "dente" },
      { key: "restauracao_2f", qty: [1, 2], region: "dente", prob: 0.6 },
      { key: "rx_periapical", qty: 1, prob: 0.7 },
    ] }],
  },
  {
    key: "perio", title: "Tratamento periodontal", weight: 7, multiPhase: false,
    phases: [{ name: "Tratamento periodontal", items: [
      { key: "raspagem", qty: [2, 4], region: "quadrante" },
      { key: "profilaxia", qty: 1 },
      { key: "fluor", qty: 1, prob: 0.5 },
    ] }],
  },
  {
    key: "endo_coroa", title: "Tratamento de canal e coroa", weight: 10, multiPhase: true,
    phases: [
      { name: "Urgência e tratamento de canal", items: [
        { key: ["endo_molar", "endo_pre", "endo_incisivo"], qty: 1, region: "dente" },
        { key: "rx_periapical", qty: 1 },
      ] },
      { name: "Reabilitação do dente", items: [
        { key: "pino", qty: 1, region: "dente" },
        { key: ["coroa_zirconia", "coroa_metaloceramica", "coroa_dissilicato"], qty: 1, region: "dente" },
      ] },
    ],
  },
  {
    key: "siso", title: "Extração de sisos", weight: 6, multiPhase: false,
    phases: [{ name: "Cirurgia", items: [
      { key: "rx_panoramica", qty: 1 },
      { key: "exo_siso", qty: [1, 2], region: "dente" },
    ] }],
  },
  {
    key: "implante", title: "Implante unitário", weight: 13, multiPhase: true,
    phases: [
      { name: "Cirurgia de implante", items: [
        { key: "tomografia", qty: 1 },
        { key: "implante", qty: 1, region: "dente" },
        { key: "enxerto", qty: 1, prob: 0.3 },
      ] },
      { name: "Prótese sobre implante", items: [{ key: "coroa_implante", qty: 1, region: "dente" }] },
    ],
  },
  {
    key: "clareamento_solo", title: "Clareamento dental", weight: 20, aesthetic: true, multiPhase: false,
    phases: [{ name: "Clareamento", items: [{ key: "clareamento", qty: 1 }] }],
  },
  {
    key: "estetica", title: "Reabilitação estética do sorriso", weight: 6, aesthetic: true, multiPhase: true,
    phases: [
      { name: "Preparo e clareamento", items: [{ key: "profilaxia", qty: 1 }, { key: "clareamento", qty: 1 }] },
      { name: "Lentes e facetas", items: [{ key: ["lente", "faceta_porcelana", "faceta_resina"], qty: [4, 6], region: "dente" }] },
    ],
  },
  {
    key: "protese", title: "Reabilitação com prótese", weight: 5, multiPhase: false,
    phases: [{ name: "Moldagem e instalação", items: [
      { key: ["protese_total", "ppr"], qty: [1, 2], region: "arcada" },
      { key: "exo_simples", qty: [1, 3], region: "dente", prob: 0.4 },
    ] }],
  },
  {
    key: "orto", title: "Tratamento ortodôntico", weight: 7, multiPhase: true,
    phases: [
      { name: "Documentação e instalação", items: [
        { key: "rx_panoramica", qty: 1 },
        { key: ["aparelho_fixo", "aparelho_estetico", "alinhadores"], qty: 1 },
      ] },
      { name: "Finalização", items: [{ key: "contencao", qty: 1 }] },
    ],
  },
  {
    key: "reabilitacao", title: "Reabilitação oral completa", weight: 6, multiPhase: true,
    phases: [
      { name: "Adequação", items: [
        { key: "raspagem", qty: 2, region: "quadrante" },
        { key: "restauracao_2f", qty: [2, 3], region: "dente" },
        { key: "endo_pre", qty: 1, region: "dente", prob: 0.5 },
      ] },
      { name: "Reabilitação", items: [
        { key: "implante", qty: [1, 2], region: "dente" },
        { key: "coroa_implante", qty: [1, 2], region: "dente" },
      ] },
      { name: "Estética", items: [{ key: "clareamento", qty: 1 }] },
    ],
  },
  {
    key: "infantil", title: "Prevenção infantil", weight: 4, pediatric: true, multiPhase: false,
    phases: [{ name: "Prevenção", items: [
      { key: "selante", qty: [2, 4], region: "dente" },
      { key: "fluor", qty: 1 },
      { key: "restauracao_1f", qty: 1, region: "dente", prob: 0.4 },
    ] }],
  },
  {
    key: "bruxismo", title: "Tratamento de bruxismo", weight: 3, multiPhase: false,
    phases: [{ name: "Placa e ajuste", items: [{ key: "placa_bruxismo", qty: 1 }, { key: "ajuste_oclusal", qty: 1, prob: 0.6 }] }],
  },
  {
    key: "harmonizacao", title: "Harmonização orofacial", weight: 2, aesthetic: true, multiPhase: false,
    phases: [{ name: "Harmonização", items: [{ key: "toxina", qty: 1 }, { key: "preenchimento", qty: 1, prob: 0.5 }] }],
  },
];

export const LOST_REASONS = [
  "Preço acima do esperado",
  "Vai pensar / sem retorno",
  "Fechou com outra clínica",
  "Sem condições financeiras no momento",
  "Priorizou outro tratamento",
  "Medo / adiou a decisão",
];

export const CITIES: { name: string; weight: number }[] = [
  { name: "Oliveira", weight: 55 },
  { name: "Carmo da Mata", weight: 8 },
  { name: "Passa Tempo", weight: 6 },
  { name: "Santo Antônio do Amparo", weight: 6 },
  { name: "Cláudio", weight: 5 },
  { name: "Bom Sucesso", weight: 4 },
  { name: "Carmópolis de Minas", weight: 4 },
  { name: "São Francisco de Paula", weight: 3 },
  { name: "Divinópolis", weight: 3 },
  { name: "Formiga", weight: 3 },
  { name: "Itapecerica", weight: 3 },
];
