/**
 * Prisma client helper.
 *
 * Goal: keep the DB access layer boring and reliable.
 * - Uses DATABASE_URL from prisma/schema.prisma (env("DATABASE_URL")).
 * - Caches the client in dev to avoid exhausting connections during HMR.
 */

// IMPORTANT:
// Do **not** import PrismaClient at module top-level.
// Prisma evaluates engine configuration early; if an environment variable like
// PRISMA_CLIENT_ENGINE_TYPE=client is present, importing the client too early
// can lock that mode in before we can apply a safe fallback.
//
// We therefore `require()` the client lazily *after* normalizing env.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrismaClientType = any;

type PrismaClientCtor = new (args?: unknown) => PrismaClientType;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientType;
};

function getPrismaCtor(): PrismaClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const prismaPkg = require("@prisma/client") as { PrismaClient: PrismaClientCtor };
  return prismaPkg.PrismaClient;
}

export function getPrisma(): PrismaClientType {
  // Some environments (or .env files) may set PRISMA_CLIENT_ENGINE_TYPE=client.
  // That mode requires a Driver Adapter or Prisma Accelerate configuration.
  // This app uses the standard query engine, so we hard-fallback to a safe
  // default to avoid runtime 500s like:
  // "Using engine type \"client\" requires either \"adapter\" or \"accelerateUrl\"..."
  const engineType = process.env.PRISMA_CLIENT_ENGINE_TYPE;
  const accelerateUrl = process.env.PRISMA_ACCELERATE_URL || process.env.ACCELERATE_URL;
  if (engineType === "client" && !accelerateUrl) {
    // Force the classic query-engine mode.
    process.env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
  }

  const PrismaClient = getPrismaCtor();

  if (process.env.NODE_ENV !== "production") {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = new PrismaClient({ log: ["error"] });
    }
    return globalForPrisma.prisma;
  }

  // In production, instantiate per process/isolate (standard Prisma guidance).
  return new PrismaClient({ log: ["error"] });
}
