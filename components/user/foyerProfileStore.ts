"use client";

// Keep "autre" for backward compatibility with previously stored profiles.
export type CoupleStatus = "marie" | "pacs" | "concubinage" | "autre";
export type HouseholdType = "single" | "couple";

export type IncomeSource = { id: string; label: string; amount: number; personId: string };

export type RentalRow = {
  id: string;
  kind: "appartement" | "maison";
  ville: string;
  superficie?: number;

  /** Loyer */
  loyer?: number;

  /** Charges variables */
  charges?: number; // charges (copro / charges locatives)
  eau?: number;
  elec?: number;
  gaz?: number;

  /** Abonnements */
  internet?: number;
  assurance?: number;

  /** Custom lines */
  customCharges?: CustomMoneyLine[];
  customAbonnements?: CustomMoneyLine[];
  customAutres?: CustomMoneyLine[];

  occupant: "commun" | string; // person id (titulaire)
};

export type MoneyPeriod = "month" | "year";

export type CustomMoneyLine = {
  id: string;
  name: string;
  amount?: number;
  period?: MoneyPeriod; // default: month
};

export type OwnerRow = {
  id: string;
  kind: "appartement" | "maison";
  ville: string;
  superficie?: number;

  /** Usage du bien */
  usage?: "primary" | "investment"; // primary = résidence principale, investment = investissement locatif

  /** Revenus */
  loyerPercu?: number;
  ownerOccupant?: boolean;

  /** Charges / taxes (inputs used for budget estimations) */
  chargesCopro?: number;

  taxeFonciere?: number;
  taxeFoncierePeriod?: MoneyPeriod; // default: year

  impotRevenu?: number;
  impotRevenuPeriod?: MoneyPeriod; // default: year

  /** legacy catch-all (kept for backward compatibility) */
  charges?: number;

  /** Charges variables */
  eau?: number;
  elec?: number;
  gaz?: number;

  /** Abonnements */
  internet?: number;
  assurance?: number;

  /** Custom lines */
  customCharges?: CustomMoneyLine[];
  customImpots?: CustomMoneyLine[];
  customAbonnements?: CustomMoneyLine[];
  customAutres?: CustomMoneyLine[];

  occupant: "commun" | string;
};


export type DailyLife = {
  courses?: number;
  transport?: number;
  loisirs?: number;
  sante?: number;
  autres?: number;
};

export type FoyerProfile = {
  foyerId: string;
  householdType?: HouseholdType;
  coupleStatus?: CoupleStatus;
  incomes?: IncomeSource[];
  isTenant?: boolean;
  rentals?: RentalRow[];
  isOwner?: boolean;
  owners?: OwnerRow[];
  daily?: DailyLife;
};

function key(foyerId: string) {
  return `test.foyerProfile.${foyerId}.v1`;
}

export function readFoyerProfile(foyerId: string): FoyerProfile {
  try {
    const raw = localStorage.getItem(key(foyerId));
    if (!raw) return { foyerId };
    const p = JSON.parse(raw) as FoyerProfile;
    // Ensure the requested foyerId always wins over any persisted value.
    return { ...p, foyerId };
  } catch {
    return { foyerId };
  }
}

export function writeFoyerProfile(profile: FoyerProfile) {
  try {
    localStorage.setItem(key(profile.foyerId), JSON.stringify(profile));

    // Notify OnlineBudgetSync (same-tab) so authenticated users get persisted online.
    window.dispatchEvent(
      new CustomEvent("app:storage", {
        detail: { key: key(profile.foyerId), ts: Date.now() },
      })
    );
  } catch {
    // ignore
  }
}

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}
