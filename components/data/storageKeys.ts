"use client";

/**
 * localStorage key helpers.
 *
 * Centralizing keys makes it safer to rename/change prefixes later,
 * and it avoids key typos across multiple stores.
 */

const PREFIX = "test";

// --- Sync meta (used to resolve conflicts between local + cloud) ---
export const keySyncMeta = `${PREFIX}.__syncMeta.v1`;

// --- Local-only sync state (NOT synced to cloud) ---
export const keyLocalSyncState = "__budget.localSyncState.v1";

// --- Patrimoine / locations ---
export const keyAssetsPerson = (personId: string) => `${PREFIX}.assets.${personId}`;
export const keyRentalsPerson = (personId: string) => `${PREFIX}.rentals.${personId}`;
export const keyAssetsFoyer = (foyerId: string) => `${PREFIX}.assets.foyer.${foyerId}`;
export const keyRentalsFoyer = (foyerId: string) => `${PREFIX}.rentals.foyer.${foyerId}`;

// --- Dépenses / revenus ---
export const keyExpensesPerson = (personId: string) => `${PREFIX}.expenses.${personId}`;
export const keyExpensesFoyer = (foyerId: string) => `${PREFIX}.expenses.foyer.${foyerId}`;
export const keyRevenusPerson = (personId: string) => `${PREFIX}.revenus.${personId}`;
export const keyRevenusFoyer = (foyerId: string) => `${PREFIX}.revenus.foyer.${foyerId}`;

// --- Graph config (Sankey columns) ---
export const keyGraphConfigFoyer = (foyerId: string) => `${PREFIX}.graphConfig.foyer.${foyerId}.v1`;
