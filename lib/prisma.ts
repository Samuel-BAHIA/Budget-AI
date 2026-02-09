/**
 * Prisma client helper.
 *
 * Goal: keep the DB access layer boring and reliable.
 * - Uses DATABASE_URL from prisma.config.ts.
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
type PrismaPgCtor = new (config: { connectionString: string }) => unknown;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientType;
};

function getPrismaCtor(): PrismaClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const prismaPkg = require("@prisma/client") as { PrismaClient: PrismaClientCtor };
  return prismaPkg.PrismaClient;
}

function tryBuildPgAdapter() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const adapterPkg = require("@prisma/adapter-pg") as { PrismaPg: PrismaPgCtor };
    return new adapterPkg.PrismaPg({ connectionString });
  } catch {
    return null;
  }
}

function isAdapterRequiredError(error: unknown) {
  const message = String((error as any)?.message ?? error ?? "");
  return message.includes('requires either "adapter" or "accelerateUrl"');
}

function createPrismaClient(): PrismaClientType {
  const PrismaClient = getPrismaCtor();
  const engineType = process.env.PRISMA_CLIENT_ENGINE_TYPE;
  const accelerateUrl = process.env.PRISMA_ACCELERATE_URL || process.env.ACCELERATE_URL;

  // If engine type is explicitly "client", prefer a real adapter first.
  if (engineType === "client" && !accelerateUrl) {
    const adapter = tryBuildPgAdapter();
    if (adapter) {
      return new PrismaClient({ log: ["error"], adapter });
    }
    // Last-resort fallback to classic query-engine mode when adapter cannot be built.
    process.env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
  }

  try {
    return new PrismaClient({ log: ["error"] });
  } catch (error) {
    // Some environments resolve client-engine mode at generation/runtime.
    // Retry once with pg adapter when constructor explicitly asks for it.
    if (isAdapterRequiredError(error)) {
      const adapter = tryBuildPgAdapter();
      if (adapter) {
        return new PrismaClient({ log: ["error"], adapter });
      }
    }
    throw error;
  }
}

export function getPrisma(): PrismaClientType {
  if (process.env.NODE_ENV !== "production") {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return globalForPrisma.prisma;
  }

  // In production, instantiate per process/isolate (standard Prisma guidance).
  return createPrismaClient();
}
