# Prisma 7 fix (Budget-AI)

This package is configured for **Prisma ORM v7**.

## What changed
- `datasource.db.url` was removed from `prisma/schema.prisma` (Prisma 7 no longer allows it).
- `DATABASE_URL` is now configured in `prisma.config.ts`.
- `lib/prisma.ts` now uses the **PostgreSQL driver adapter** (`pg` + `@prisma/adapter-pg`), as required by Prisma 7.

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

> Ensure `DATABASE_URL` exists in `.env.local`.
