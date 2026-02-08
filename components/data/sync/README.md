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
