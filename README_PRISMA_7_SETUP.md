# Prisma 7 setup (Budget-AI)

This project is configured for **Prisma 7**.

## What changed vs Prisma 6

- `datasource.url` is **no longer allowed** in `prisma/schema.prisma`.
- The database URL is configured in `prisma.config.ts`.
- Prisma 7 requires passing either a driver **adapter** (direct DB connection) or an `accelerateUrl`
  to `new PrismaClient()`.

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
