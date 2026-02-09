# Prisma 7 fix (Budget-AI)

This package is configured for **Prisma ORM v7**.

## What changed
- `datasource.db.url` was removed from `prisma/schema.prisma` (Prisma 7 no longer allows it).
- `DATABASE_URL` is now configured in `prisma.config.ts`.
- `lib/prisma.ts` forces a safe fallback to classic engine mode when `PRISMA_CLIENT_ENGINE_TYPE=client`
  is present without adapter/accelerate config.

## Install deps (if missing)
```bash
npm i @prisma/client
npm i -D prisma dotenv
npm i pg @prisma/adapter-pg
```

## Generate + run
```bash
npx prisma generate
npm run dev
```

> Ensure `DATABASE_URL` exists in `.env.local` (loaded first in `prisma.config.ts`).
