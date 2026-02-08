/**
 * Prisma client helper (Prisma ORM v7).
 *
 * Notes:
 * - Prisma 7 requires a driver adapter (direct DB connection) OR an Accelerate URL.
 * - Here we use the PostgreSQL driver adapter via `pg` + `@prisma/adapter-pg`.
 * - We keep lazy `require()` to avoid Next.js build-time crashes if Prisma Client
 *   hasn't been generated yet.
 */

export type PrismaClientType = any;

const globalForPrisma = globalThis as unknown as {
  __prisma?: PrismaClientType;
  __pgPool?: any;
};

function createPrismaClient(): PrismaClientType {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (or your environment) before using Prisma."
    );
  }

  // Lazy requires (avoid failing during Next build when client isn't generated yet)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require("@prisma/client") as { PrismaClient: any };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg") as { Pool: any };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaPg } = require("@prisma/adapter-pg") as { PrismaPg: any };

  const pool =
    globalForPrisma.__pgPool ??
    new Pool({
      connectionString: databaseUrl,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__pgPool = pool;
  }

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: ["error"],
  });
}

export function getPrisma(): PrismaClientType {
  if (process.env.NODE_ENV !== "production") {
    if (!globalForPrisma.__prisma) {
      globalForPrisma.__prisma = createPrismaClient();
    }
    return globalForPrisma.__prisma;
  }

  // In production, avoid putting it on a global that might be shared across isolates.
  return createPrismaClient();
}
