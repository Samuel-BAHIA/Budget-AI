// Centralized number formatting helpers.
// Keeping Intl.NumberFormat instances at module scope avoids heavy re-creation on every render.

const EUR_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function formatEUR(value: number): string {
  return EUR_FORMATTER.format(value);
}
