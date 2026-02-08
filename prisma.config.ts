import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Prisma 7: connection URLs are configured here (not in schema.prisma)
  datasource: {
    url: env("DATABASE_URL"),
  },
});
