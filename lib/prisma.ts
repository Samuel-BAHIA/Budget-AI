/**
 * Prisma client helper.
 *
 * Goal: keep the DB access layer boring and reliable.
 * - Uses DATABASE_URL from prisma/schema.prisma (env("DATABASE_URL")).
 * - Caches the client in dev to avoid exhausting connections during HMR.
 */

import { PrismaClient } from "@prisma/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrismaClientType = any;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  // Prisma can be configured to use the "client" engine (driver adapters / Accelerate).
  // If PRISMA_CLIENT_ENGINE_TYPE=client is set but no adapter/accelerate URL is provided,
  // Prisma throws: "requires either adapter or accelerateUrl".
  // In this project we want local dev to "just work", so we fall back to the default engines.
  const engineType = process.env.PRISMA_CLIENT_ENGINE_TYPE;
  const accelerateUrl = process.env.PRISMA_ACCELERATE_URL || process.env.ACCELERATE_URL;
  if (engineType === "client" && !accelerateUrl) {
    // Mutating process.env is safe here: it runs once per server process/isolate.
    process.env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
  }

  if (process.env.NODE_ENV !== "production") {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = new PrismaClient({ log: ["error"] });
    }
    return globalForPrisma.prisma;
  }

  // In production, instantiate per process/isolate (standard Prisma guidance).
  return new PrismaClient({ log: ["error"] });
}
