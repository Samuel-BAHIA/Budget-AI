# AI Handoff Notes (Budget-AI)

Ce fichier liste les erreurs qui ont deja casse le projet, avec le "pourquoi".

## 1) Crash runtime dans le layout (`layout-*.js`)

- Symptome: stack minifiee avec beaucoup de frames React (`ol/or/...`) et crash dans le bundle layout.
- Cause observee: `usePathname()` utilise sans fallback dans un composant toujours monte du layout.

Regle:
- Quand tu utilises `usePathname()`, prevois toujours une fallback (`?? ""` ou `?? "/"`) avant `startsWith`.
- Sinon un `null` transitoire peut faire planter toute l'app shell.

## 2) Prisma 7: ne PAS remettre `datasource.url` dans `schema.prisma`

- Prisma 7 n'accepte plus `url` dans `prisma/schema.prisma`.
- La connexion DB doit rester dans `prisma.config.ts` via:
  - `datasource: { url: env("DATABASE_URL") }`

Regle:
- Si tu reintroduis `url = env("DATABASE_URL")` dans le schema, `prisma` plante (P1012).

## 2bis) Erreur runtime Prisma en dev: engine "client"

- Symptome:
  - `/api/budget-state` renvoie 500
  - `PrismaClientConstructorValidationError: Using engine type "client" requires either "adapter" or "accelerateUrl"`

Cause:
- selon l'environnement, Prisma peut se retrouver en mode `client` au runtime.

Etat voulu:
- `lib/prisma.ts` doit:
  - tenter `new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })`
  - et garder un fallback robuste.

Regle:
- Ne simplifie pas `lib/prisma.ts` en retirant cette gestion, sinon le bug revient en dev.

## 2ter) Neon indisponible en dev (ETIMEDOUT)

- Symptome:
  - `/api/budget-state` peut timeout (`ETIMEDOUT`) selon reseau/VPN/firewall.

Etat voulu:
- `app/api/budget-state/route.ts` doit degrader proprement:
  - GET: fallback local (pas 500)
  - POST: statut degrade (pas 500 bloquant)

Regle:
- Ne retransforme pas ces cas reseau en erreurs 500 bruyantes; l'app est local-first.

## 3) Build vs migrations: ne pas coupler `build` et `migrate deploy`

- Le hook `pre-push` lance `npm run check`.
- Si `build` contient `prisma migrate deploy`, un souci DB reseau/engine casse le push meme si le code compile.

Etat voulu:
- `build`: `npm run clean && prisma generate && next build`
- Migration manuelle separee: `npm run db:migrate:deploy`

## 4) Chargement env Prisma

- Prisma CLI ne suit pas toujours l'ordre de chargement Next.js.
- `prisma.config.ts` charge explicitement:
  - `.env.local` d'abord
  - puis `.env` en fallback

Regle:
- Ne retire pas ce chargement explicite, sinon ecarts local/CI/prod possibles.

## 5) Sync localStorage: eviter les boucles evenementielles

- Le projet utilise `window.dispatchEvent("app:storage")` pour synchroniser les hooks en onglet courant.
- Les stores et `OnlineBudgetSync` sont sensibles aux ecritures en boucle.

Regles:
- Ne pas ajouter des `setState` non gardes dans les listeners `app:storage`.
- Garder les protections existantes (`sameLines`, `isHydrating`, scope guards) avant toute refacto.

## Check final obligatoire avant push

Toujours executer:

```bash
npm run check
```

Puis push normal (sans `--no-verify`) pour verifier le hook pre-push.

## Scripts a ne pas casser

- `predev` doit rester actif pour nettoyer `.next` avant `next dev`.
- `postinstall` doit rester actif pour garantir `prisma generate` apres install.
- `build` doit rester sans migration DB (migrations manuelles via `db:migrate:deploy`).
