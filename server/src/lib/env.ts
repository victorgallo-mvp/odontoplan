// Carrega server/.env e garante o banco local padrão quando DATABASE_URL não
// foi definido (caminho relativo ao schema.prisma → server/prisma/dev.db).
import "dotenv/config";

process.env.DATABASE_URL ||= "file:./dev.db";

/** Produção = Railway ou NODE_ENV=production. */
export const isProduction = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;
