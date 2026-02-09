import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma CLI does not automatically mirror Next.js env loading order.
// Load .env.local first, then .env as fallback.
loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Prisma 7: connection URLs are configured here (not in schema.prisma)
  datasource: {
    url: env("DATABASE_URL"),
  },
});
