// Roda o Prisma CLI com o schema certo para o banco em uso:
//   DATABASE_URL começa com "file:" (ou não existe, fora de produção) → SQLite local
//   qualquer outro valor (postgresql://…)                             → PostgreSQL
// O schema.prisma é a fonte única (provider "postgresql"); para SQLite geramos
// schema.sqlite.prisma ao lado dele, trocando só o provider.
//
// Uso: node prisma/run.mjs <args do prisma>   (ex.: generate | db push --skip-generate)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const here = dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;
if (!process.env.DATABASE_URL && !production) process.env.DATABASE_URL = "file:./dev.db";
const url = process.env.DATABASE_URL ?? "";
const sqlite = url.startsWith("file:");

const args = process.argv.slice(2);
if (sqlite) {
  const main = readFileSync(join(here, "schema.prisma"), "utf8");
  if (!main.includes('provider = "postgresql"')) throw new Error('schema.prisma precisa ter provider = "postgresql"');
  const header = "// GERADO por prisma/run.mjs a partir de schema.prisma. Não edite: altere o schema.prisma.\n";
  writeFileSync(join(here, "schema.sqlite.prisma"), header + main.replace('provider = "postgresql"', 'provider = "sqlite"'));
  args.push("--schema", join(here, "schema.sqlite.prisma"));
} else {
  args.push("--schema", join(here, "schema.prisma"));
}
console.log(`[prisma] banco: ${sqlite ? "SQLite local" : url ? "PostgreSQL" : "PostgreSQL (DATABASE_URL ainda não definido)"}`);
// Chama o CLI do Prisma pelo caminho do pacote (funciona com ou sem node_modules/.bin no PATH)
const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const r = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
