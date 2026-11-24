# OdontoPlan

Copiloto de planos de tratamento para clínicas odontológicas. Roda 100% local
com dados de seed (integração Clinicorp mockada) ou, com credenciais no
`server/.env`, importa os dados reais da API REST do Clinicorp.

## Rodando

```bash
npm install      # instala server + web e gera o Prisma Client
npm run seed     # cria o SQLite (server/prisma/dev.db) e popula dados fictícios
npm run dev      # API em http://localhost:3001 e web em http://localhost:5173
npm test         # testes unitários das regras de negócio (vitest)
```

Antes do primeiro `npm run seed`, crie o `server/.env`: `cp .env.example server/.env`
(ele já traz `DATABASE_URL="file:./dev.db"`, o SQLite local). Para habilitar os
textos gerados por IA, preencha `ANTHROPIC_API_KEY`. Sem a chave, o app usa
templates de fallback e funciona por completo.

Portas em uso por outro projeto? `PORT=3002 WEB_PORT=5174 npm run dev` sobe a
API em 3002 e o web em 5174 (o proxy `/api` acompanha).

`npm run seed` é idempotente: apaga os dados anteriores e repopula com a mesma
semente (resultado determinístico).

## Deploy (Railway + Vercel)

**Backend no Railway** (raiz do repositório; `railway.json` já define build e start):

1. New Project → Deploy from GitHub repo → este repositório.
2. No projeto, adicione um banco **PostgreSQL** (New → Database → PostgreSQL).
3. Variables do serviço: `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
   `APP_PASSWORD=<senha de acesso>`, `CORS_ORIGIN=https://<projeto>.vercel.app`,
   as três `CLINICORP_*` e, opcional, `ANTHROPIC_API_KEY`.
4. Settings → Networking → Generate Domain. `GET /api/health` deve responder.

Produção usa PostgreSQL; o desenvolvimento local continua em SQLite
(`DATABASE_URL="file:./dev.db"`). O `server/prisma/run.mjs` escolhe o provider
pelo `DATABASE_URL` a partir do mesmo `schema.prisma`.

O start roda `prisma db push` (cria/atualiza as tabelas) e sobe a API. Em
produção o servidor **não sobe sem `APP_PASSWORD`**: o app guarda dados de
pacientes e a senha é a única barreira de acesso.

**Frontend no Vercel**: Add New Project → o mesmo repositório → Root Directory
`web` (framework Vite) → variável `VITE_API_URL=https://<servico>.up.railway.app`
(sem `/api`). O `web/vercel.json` cuida das rotas do React Router.

Primeiro acesso: entre com a senha; com o banco vazio e o Clinicorp
configurado, a tela oferece "Importar do Clinicorp" (90 dias).

## Integração Clinicorp (real)

Credenciais em **Gerenciar Assinatura → Acesso Externo e Integrações →
Integrações** (Usuário API + Token API). No `server/.env`:

```
CLINICORP_API_USER=<usuario api>
CLINICORP_API_TOKEN=<token>
CLINICORP_SUBSCRIBER_ID=<id do assinante>   # default = CLINICORP_API_USER
```

```bash
npm run sync -- --days 30     # CLI; ou POST /api/sync?days=30 com o servidor rodando
```

O sync cria (ou atualiza) uma `Clinic` própria com `externalId` = BusinessId
do Clinicorp e importa tudo para ela — os dados reais **nunca** se misturam
com os do seed. Com as credenciais presentes, o app passa a exibir essa clínica
(`CLINIC_ID` no `.env` força outra). Sem credenciais, tudo volta ao seed.

O que a API do Clinicorp dá e como mapeamos (`server/src/clinicorp/mapping.ts`):

| Recurso | Endpoint | Observação |
|---|---|---|
| Clínica | `/business/list` | nome, endereço (cidade/UF extraídos), e-mail |
| Dentistas | `/professional/list_all_professionals` | só id, nome e CPF (sem CRO) |
| Orçamentos | `/estimates/list` (janelas de ≤31 dias) | `TreatmentId` é o id estável; `APPROVED/REJECTED*/OPEN+FOLLOWUP` → aceita/perdida/apresentada; itens `Deleted` e, nos aprovados, `NotApproved` ficam fora |
| Procedimentos | derivados dos itens dos orçamentos | `/procedures/list` não tem preço e usa outro id; o catálogo local é o que apareceu em orçamentos, com o preço de tabela mais recente |
| Pacientes | derivados de orçamentos + agenda + pagamentos | não existe "listar pacientes"; sem data de nascimento/sexo |
| Agenda | `/appointment/list` + `/appointment/status_list` | horário = `AtomicDate` + `fromTime` no fuso `CLINICORP_TZ_OFFSET` (default -03:00); sem StatusId, passado = realizada e futuro = agendada; tipo inferido do texto da categoria |
| Pagamentos | `/payment/list` (recebidos + lançados no período) | vinculados por `TreatmentId`; pago/atrasado/pendente |

A sincronização é **manual**: botão "Sincronizar agora" no menu lateral (30
dias), `POST /api/sync?days=N` ou `npm run sync -- --days N`. O menu mostra a
data do último sync. `npm run purge-seed` apaga as clínicas fictícias (sem
`externalId`) sem tocar na importada.

**Excluir orçamento**: botão na página da proposta e "✕" no card do Kanban.
Remove fases, itens, eventos e pagamentos vinculados; consultas ficam sem
proposta. Se o orçamento veio do Clinicorp, fica uma lápide em
`proposal_tombstones` e o sync não o reimporta. A API do Clinicorp não permite
excluir nem criar orçamentos (só leitura), então lá ele continua existindo.

Cota padrão da API: **25 requisições/hora**. Um sync de 30 dias usa 7; cada
31 dias extras custam 4. Erros 429 vêm com mensagem clara no `sync_logs`.

## Estrutura

```
server/                 Node + Express + Prisma (PostgreSQL em produção, SQLite local)
  prisma/schema.prisma  schema (multi-tenant: clinic_id em toda tabela)
  prisma/seed.ts        gerador de dados fictícios com padrões embutidos
  prisma/seed-data.ts   tabela de procedimentos e arquétipos de plano
  src/domain/           regras de negócio determinísticas (+ testes)
    payment.ts          simulador de pagamento (à vista, cartão c/ taxa, próprio)
    churn.ts            score de risco 0–100 com motivos em texto
    pricing.ts          aceitação por faixa de preço / dentista / parcelas
  src/clinicorp/        adapter: interface, mock, client real (+ mapping.ts testado) e SyncService
  src/sync.ts           CLI do sync (npm run sync -- --days N)
  src/ai/               Claude API com fallback obrigatório (texto, nunca números)
  src/services/         consultas: dashboard, risco, precificação, propostas
  src/routes/index.ts   rotas REST (/api/*)
web/                    React + Vite + Tailwind
  src/pages/            Dashboard, NovoPlano, Kanban, Risco, Proposta, Precificacao
```

## Telas

| Rota | O que faz |
|---|---|
| `/` | KPIs de 30/90 dias, propostas por mês, valor aceito por categoria, ranking de dentistas (valor aceito, fechadas, ticket médio, aceitação, pago, em aberto), funil, follow-ups pendentes |
| `/novo-plano` | Busca paciente, monta fases + procedimentos, alerta de preço fora de ±10% da tabela, simulador de pagamento (à vista, cartão c/ repasse de taxa, boleto/pix c/ entrada), gera a proposta |
| `/propostas` | Kanban com drag-and-drop (@dnd-kit), filtro por dentista, badge amarela para "Apresentada" há mais de 7 dias, motivo de perda |
| `/propostas/:id` | Proposta em HTML editável (contentEditable), regenerar textos com IA, mover de etapa, escolher condição sugerida, imprimir/salvar PDF (A4, CSS de impressão) |
| **Plano de ação** (modal ao clicar num cartão do Kanban ou em "Precisam de retorno" no Dashboard; também é uma aba em `/propostas/:id`) | Decisão por item (pendente / aceito / recusado com motivo) e confirmação de pagamento dos aceitos; ações em lote por fase. No Kanban a proposta com decisões misturadas aparece dividida: parte aceita em "Aceita", parte recusada em "Perdida" e o que falta decidir na etapa atual (é a única parte que arrasta). Arrastar para "Aceita"/"Perdida" decide os itens pendentes; arrastar de volta para uma etapa aberta devolve a pendente os itens não pagos |
| `/configuracoes` | Serviços e valores de tabela, tipo de tratamento (clínico / funcional / estético, com sugestão pelo nome), regras de pagamento (entrada mínima em % ou R$, taxas do cartão) e modelos de plano |
| `/risco` | Pacientes rankeados por score 0–100 com motivos em texto, valor parado e botão que gera mensagem de WhatsApp para copiar |
| `/precificacao` | Destaques automáticos, aceitação por faixa de preço (quartis), por dentista, heatmap parcelas × ticket (com filtro "só implante") |

**Odontograma** (`web/src/components/Odontograma.tsx`, notação FDI): no "Novo
plano" cada item abre o seletor para marcar vários dentes do mesmo
procedimento (a quantidade acompanha o nº de dentes). Cada fase tem o seu
próprio odontograma, logo abaixo dos itens, tanto no "Novo plano" quanto na
proposta impressa, colorido por tipo de tratamento. Os dentes continuam gravados como
texto em `tooth_region` ("16, 26 · observação").

**Entrada**: no simulador pode ser digitada em % ou em R$; o mínimo da clínica
é % do total ou valor fixo (`min_down_payment_mode`).

Serviços com nome, valor ou situação editados em Configurações ficam com
`locally_edited = true` e o sync do Clinicorp não os sobrescreve.

## IA (Claude API)

`server/src/ai/AiService.ts`. Com `ANTHROPIC_API_KEY` usa a API (modelo em
`ANTHROPIC_MODEL`, default `claude-sonnet-4-5`); sem a chave, ou em qualquer
erro/timeout, usa os templates de `fallback.ts`. Usos: textos da proposta
(resumo, fases, benefícios), mensagem de reativação e um stub de classificação
de procedimentos. Regra LGPD no código: só o primeiro nome do paciente vai para
a API, junto de procedimentos, fases e valores — nunca telefone, e-mail,
nascimento ou anotações clínicas. Toda saída é rascunho e aparece em campo
editável.

## API

```
GET  /api/health · /api/clinic · /api/dentists · /api/procedures
GET  /api/patients?q= · /api/patients/:id
GET  /api/payment/config · POST /api/payment/scenarios
GET  /api/proposals?stage=&dentistId= · POST /api/proposals · GET /api/proposals/:id
PATCH /api/proposals/:id · PATCH /api/proposals/:id/stage · PATCH /api/proposals/:id/items · POST /api/proposals/:id/texts · DELETE /api/proposals/:id
GET  /api/dashboard?period=month|quarter · GET /api/risk?min= · POST /api/risk/:patientId/message
POST /api/procedures · PATCH /api/procedures/:id · POST /api/procedures/suggest-categories · PATCH /api/settings
GET  /api/plan-templates · POST /api/plan-templates · PATCH /api/plan-templates/:id · DELETE /api/plan-templates/:id
GET  /api/pricing · POST /api/ai/classify-procedure · POST /api/sync?days=30 · GET /api/sync/logs
```

## Decisões

- **Schema portável**: sem Json nem enum nativo (SQLite não suporta); enums
  são `String` documentados no schema e tipados em `src/domain/types.ts`. O
  mesmo schema roda em PostgreSQL (produção) e SQLite (local).
- **Status Clinicorp × Kanban**: a proposta guarda só o `stage` do Kanban;
  `aprovado/recusado/pendente` é derivado (`estimateStatusFromStage`).
- **Desconto fica no preço do item** (`unit_price` vs `reference_price`); o
  campo `discount` da proposta é um abatimento adicional em R$.
- **Números nunca vêm da IA**: parcelamento, taxas, totais, scores e bandas de
  preço são código testado em `src/domain`.
- **Sync**: `SyncService` faz upsert por `(clinic_id, external_id)`; propostas
  já existentes nunca têm fases/textos sobrescritos pelo Clinicorp. O client
  real baixa cada recurso uma vez por sync e deriva pacientes/procedimentos em
  memória, por causa da cota de 25 req/hora.

## Dados do seed

Clínica Sorria Mais (Oliveira/MG), 3 dentistas com perfis distintos, 55
procedimentos classificados (clínico/funcional/estético), 300 pacientes,
~990 consultas em 18 meses (~13% no-show), 350 propostas (≈40% aceitas,
≈35% perdidas, ≈25% pendentes) e pagamentos coerentes. Padrões embutidos de
propósito: clareamento converte muito melhor abaixo de R$ 1.200, implante
converte mal com menos de 6x, Dr. júnior desconta mais e converte menos, 60
pacientes em churn (>8 meses), ~45 com revisão vencida, ~25 com tratamento
aprovado parado. O seed imprime esse resumo ao final.
