# AI Notes – Sync / sauvegarde (à lire avant de toucher au code)

Objectif produit (rappel)
- Un utilisateur se connecte sur **n’importe quel device**.
- Il retrouve **SES** données (foyers, personnes, budgets, etc.) à jour.
- Les **modifications** et **suppressions** doivent se propager (pas de résurrection).
- Les conflits d’édition doivent être résolus sans casser les données.

## Architecture (où ça se passe)
- `components/data/sync/budgetSyncEngine.ts`
  - Export / Apply / Merge de snapshots
  - Tombstones (suppression) + merge JSON
  - Log local-only (clé `__budget.syncLog.v1`) pour debug
- `components/data/OnlineBudgetSync.tsx`
  - Wire React + NextAuth + déclenchement auto

## Piège classique (déjà rencontré)
### 1) Snapshot “vide” mais avec tombstones
Le snapshot peut contenir **uniquement** `test.__tombstones.v1`.
Si on le considère comme “data présente”, on peut rentrer dans une boucle :
- “Cloud vide” / “Local vide” mal détecté → merge/push en continu

Correctif appliqué :
- `hasAnyBudgetData()` et `stableHash()` ignorent
  - `keySyncMeta`
  - `test.__tombstones.v1`

### 2) Conflits d’édition sur le même objet (ex: même foyer modifié sur 2 devices)
Sans timestamps, un deep-merge peut mélanger des champs de façon non déterministe.
Correctif appliqué :
- `deepMerge()` pour les tableaux d’objets `{id}` devient **timestamp-aware** :
  - si `updatedAt` (ou `_updatedAt`) existe des deux côtés → on garde l’objet **le plus récent** (remplacement complet)
  - sinon → merge récursif classique

## Convention de timestamp (IMPORTANT)
Pour que la résolution de conflit marche correctement :
- Les objets “métier” dans des arrays `{id}` doivent porter un `updatedAt: number` (ms epoch).
- Toute action UI qui modifie l’objet doit mettre à jour `updatedAt = Date.now()`.

Déjà implémenté dans :
- `components/user/UserProvider.tsx` pour `Foyer` + `Person`

## Comment diagnostiquer un bug “stack trace minifiée”
Symptôme vu : stack trace en boucle dans des chunks Next.js minifiés (`layout-*.js`, `*.js:1`).
Souvent, ça correspond à :
- boucle de merge/push → rendu / effets qui s’enchaînent
- ou récursion non bornée dans un merge

Procédure rapide :
1. Ouvrir la console et lire `localStorage.getItem("__budget.syncLog.v1")`
2. Vérifier si `hydrate.start` / `hydrate.fail` / `push.fail` spam
3. Inspecter `test.__syncMeta.v1` + `test.__tombstones.v1`
4. Comparer les hashes (fonction `stableHash`) si besoin

## Règles d’or (ne pas casser)
- Ne JAMAIS renommer une clé localStorage sans prévoir une migration.
- Toute nouvelle clé “meta” sous le préfixe `test.` doit être exclue de :
  - `hasAnyBudgetData()`
  - `stableHash()`
- Ne jamais synchroniser des clés local-only (ex: `__budget.*`).

