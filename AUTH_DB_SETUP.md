# Auth + Neon Postgres (Next.js / TypeScript)

This project includes scaffolding for:
- Sign-in with Google / Facebook (NextAuth)
- Per-user persistent storage in Neon Postgres (Prisma)

## 1) Environment variables
Copy `.env.example` to `.env.local` and fill:
- `DATABASE_URL` (use Neon **pooled** connection string)
- `NEXTAUTH_*`
- OAuth provider secrets

## Local vs Production (no manual switching)

You should **never** set `NEXTAUTH_URL` to a callback URL like `/api/auth/callback/google`.
`NEXTAUTH_URL` must be the **site base URL** only.

- Local dev: put this in `.env.local` (stays on your machine)
  - `NEXTAUTH_URL="http://localhost:3000"`
- Production (Vercel): set an Environment Variable in your Vercel project
  - `NEXTAUTH_URL="https://YOUR-DOMAIN"`

NextAuth will automatically generate the correct callback URLs under `/api/auth/callback/*`.

### Google redirect URIs
In Google Cloud Console → OAuth Client → **Authorized redirect URIs**, add BOTH:

- `http://localhost:3000/api/auth/callback/google`
- `https://YOUR-DOMAIN/api/auth/callback/google`

(Replace `YOUR-DOMAIN` with your Vercel domain or custom domain.)

### If you get a 404 on `/api/auth/callback/google`
That almost always means Next.js is **not picking up** the NextAuth route file.
Some repos are configured with `src/app` (instead of `app`).
To be robust, this zip includes the API routes in **both** locations:

- `app/api/...`
- `src/app/api/...`

So whichever routing layout your repo uses, Vercel should route callbacks correctly.

## 2) Prisma migrations
Run once:
```bash
npx prisma migrate dev --name init
```

## 3) Using the API
`GET /api/budget-state` -> `{ data: ... }`
`POST /api/budget-state` with JSON body `{ data: <any json> }`

Both endpoints require being signed in.

## Guest mode (not authenticated)

- Not authenticated => the app stays **100% local** (localStorage only) and does **not** call the DB.
- Authenticated => the app syncs a snapshot of all localStorage keys starting with `test.` to Neon.

## Notes
For a quick first version, `session.user.id` is mapped to the user's email.
You can later move to a full NextAuth Prisma adapter with a `User` table.
