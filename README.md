# Budget-AI (Next.js + Prisma 7)

## Commandes stables

```bash
npm install
npm run dev
```

```bash
npm run check
```

```bash
npm run build
npm run start
```

## Ce qui est fiabilise (dev + prod)

- `predev` nettoie `.next` avant `next dev` pour eviter les erreurs cache (`Cannot find module './*.js'`).
- `build` nettoie puis regenere Prisma Client avant `next build`.
- `postinstall` regenere Prisma Client apres installation de dependances.
- Le hook Git `pre-push` execute `npm run check`.

## Prisma 7 (important)

- Ne pas remettre `datasource.url` dans `prisma/schema.prisma` (interdit en Prisma 7).
- L'URL DB est configuree dans `prisma.config.ts`.
- Les migrations sont separees du build:

```bash
npm run db:migrate:deploy
```

### Erreur dev connue et corrigee

Si tu vois:

`PrismaClientConstructorValidationError: Using engine type "client" requires either "adapter" or "accelerateUrl"`

alors:
- le runtime Prisma est parti en mode `client`,
- et il lui faut un adapter PostgreSQL (ou Accelerate).

Le projet gere maintenant ce cas dans `lib/prisma.ts`:
- tentative automatique avec `@prisma/adapter-pg` + `DATABASE_URL`,
- fallback de securite si necessaire.

### Si Neon est inaccessible en dev (timeout reseau)

Symptome possible:
- `PrismaClientKnownRequestError`
- `code: 'ETIMEDOUT'` sur `/api/budget-state`

Comportement voulu:
- l'API `budget-state` degrade en mode local (pas de crash global),
- GET renvoie un fallback local,
- POST renvoie un statut de degradation au lieu d'un 500.

Donc:
- warning/timeout reseau DB != bug front/build,
- l'app reste utilisable localement meme sans connexion Neon.

## Documentation projet

- `AI_HANDOFF.md`: erreurs deja rencontrees + regles a ne pas casser.
- `README_PRISMA7.md`: rappel Prisma 7.
- `AUTH_DB_SETUP.md`: auth + Neon.
