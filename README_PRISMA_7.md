# Prisma 7 fix (Budget-AI)

This project is using Prisma CLI v7.x.

## What changed in Prisma 7

1) `datasource.db.url` is no longer allowed inside `prisma/schema.prisma`.
   The connection URL must be configured in `prisma.config.ts`.

2) Prisma Client with engine type "client" requires either:
   - a **driver adapter** (direct DB connection), or
   - an **accelerateUrl** (Prisma Accelerate).

This repo avoids runtime failures by forcing a safe fallback to classic engine mode
when `PRISMA_CLIENT_ENGINE_TYPE=client` is set without adapter/accelerate config.

## Required dependencies

Make sure your project has these installed:

```bash
npm i @prisma/client
npm i -D prisma
npm i pg @prisma/adapter-pg
```

## Generate Prisma Client

```bash
npx prisma generate
```

## Environment

Add `DATABASE_URL` to `.env.local`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public"
```

`prisma.config.ts` loads `.env.local` first, then `.env` as fallback.

Then run:

```bash
npm run dev
```
