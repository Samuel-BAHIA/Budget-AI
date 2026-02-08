import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Prisma reads DATABASE_URL from your environment (.env / .env.local / Vercel env vars)
});
