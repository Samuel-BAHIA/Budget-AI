# Prisma 7 setup (Budget-AI)

This project is configured for **Prisma 7**.

## What changed vs Prisma 6

- `datasource.url` is **no longer allowed** in `prisma/schema.prisma`.
- The database URL is configured in `prisma.config.ts`.
- If `PRISMA_CLIENT_ENGINE_TYPE=client` is set without adapter/accelerate config, runtime can crash.
- This repo applies a safe fallback in `lib/prisma.ts` to avoid that failure mode.

## Install required dependencies

Make sure you have these packages:

```bash
npm i @prisma/client
npm i -D prisma
npm i pg @prisma/adapter-pg
```

## Environment

Add `DATABASE_URL` to `.env.local`:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB?schema=public"
```

## Generate Prisma Client

```bash
npx prisma generate
```

## Run

```bash
npm run dev
```

## Build safety

- `build` does not run migrations.
- Deploy migrations manually with:

```bash
npm run db:migrate:deploy
```
