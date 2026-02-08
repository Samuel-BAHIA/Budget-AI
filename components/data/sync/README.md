# Budget Sync (localStorage ⇄ server)

This folder contains the **entire sync logic** used by the app to keep a user's local budget
data (stored in `localStorage`) synchronized with the server snapshot.

## Where to look

- `budgetSyncEngine.ts` → the **engine** (pure helpers + fetch/push)
- `../OnlineBudgetSync.tsx` → the **React wrapper** that wires the engine to NextAuth + React effects

If an AI needs to change sync behavior, it should start here. No need to scan the whole repo.

## Data model

### Snapshot
A snapshot is a raw capture of localStorage:

- Only keys starting with `STORAGE_PREFIX` are included (`"test."`).
- Values are stored as **raw strings** (usually JSON).

```ts
type Snapshot = { v: 1; storage: Record<string, string> };
```

### Meta (`keySyncMeta`)
A special storage entry used to detect recency and avoid loops:

- `updatedAt` is bumped on every local write
- `lastSyncedAt` / `lastSyncedHash` are updated when we push to the server

## Conflict policy (important)

When local and cloud snapshots differ, we **AUTO-MERGE**:

- Merge is per-key.
- If both sides are JSON → deep merge.
- Primitive conflicts → local wins.

There is **no UI popup**.

## Deletions (important)

Because a deletion can be represented as "absence" (which would otherwise be re-imported from the other device),
the sync engine uses **tombstones** stored inside the synced snapshot.

### Key deletions

- Stored in `test.__tombstones.v1` as:
  - `"test.some.key" -> deletedAt`
- If a key is tombstoned, it is removed from the merged snapshot and also removed locally during apply.

### Item deletions inside arrays

Some important keys are JSON arrays of objects with an `id` (example: `test.foyers.v1`).
Deleting an item from the array does **not** remove the localStorage key, so we also track deletions per-item.

- Tombstone format:
  - `"<storageKey>::id::<id>" -> deletedAt`
- During merge/apply, any array item whose id is tombstoned is filtered out (so it cannot resurrect).
