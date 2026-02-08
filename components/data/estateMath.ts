"use client";

import { sumAmounts } from "@/components/data/storage";

export type AssetLike = { incomes?: Array<{ amount: number }>; expenses?: Array<{ amount: number }> };
export type RentalLike = { expenses?: Array<{ amount: number }> };

export function assetNet(a: AssetLike) {
  return sumAmounts(a.incomes) - sumAmounts(a.expenses);
}

export function rentalNet(r: RentalLike) {
  return -sumAmounts(r.expenses);
}
