/**
 * Prisma client helper.
 *
 * Important: we intentionally *do not* import or require `@prisma/client` at the
 * module top-level.
 *
 * Why?
 * - During `next build`, Next.js may load route modules while collecting page data.
 * - If Prisma Client hasn't been generated yet, requiring `@prisma/client` throws:
 *   "Cannot find module '.prisma/client/default'".
 *
 * By lazy-loading Prisma only when a handler actually runs, the build can complete,
 * and runtime environments can still use Prisma once generated.
 */

// Keep the type loose to avoid TS failing when Prisma Client isn't generated.
export type PrismaClientType = any;

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClientType };

export function getPrisma(): PrismaClientType {
  if (process.env.NODE_ENV !== "production") {
    if (!globalForPrisma.__prisma) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PrismaClient } = require("@prisma/client") as { PrismaClient: any };
      globalForPrisma.__prisma = new PrismaClient({ log: ["error"] });
    }
    return globalForPrisma.__prisma;
  }

  // In production, avoid putting it on a global that might be shared across isolates.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require("@prisma/client") as { PrismaClient: any };
  return new PrismaClient({ log: ["error"] });
}
