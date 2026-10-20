// Prices for PermitPal Plus, staff licences and White-label. The database works out every bill the same way
// (private.staff_monthly / private.addon_price); these only show the price before asking it.
export const FREE_PEOPLE = 3;
export const PLUS_MONTHLY = 199;
export const BRAND_MONTHLY = 1000; // White-label, for accounting firms
export const YEAR_MONTHS = 10; // yearly = 10 months' price (2 months free)

// People 1-3 free; each person from the 4th to the 20th ₱100 a month, the 21st to the 100th ₱60,
// the 101st on ₱40. Each price only covers the people in its band, so one more person never costs less.
export const BANDS = [
  { from: FREE_PEOPLE + 1, to: 20, each: 100 },
  { from: 21, to: 100, each: 60 },
  { from: 101, to: Infinity, each: 40 },
];
export function staffBands(people) {
  const n = Math.max(0, Math.floor(Number(people) || 0));
  return BANDS.map((b) => ({ ...b, count: Math.max(0, Math.min(n, b.to) - b.from + 1) })).filter((b) => b.count > 0)
    .map((b) => ({ ...b, amount: b.count * b.each }));
}
export const staffMonthly = (people) => staffBands(people).reduce((t, b) => t + b.amount, 0);
export const addonPrice = (kind, people, billing) => (kind === 'plus' ? PLUS_MONTHLY : kind === 'brand' ? BRAND_MONTHLY : staffMonthly(people)) * (billing === 'yearly' ? YEAR_MONTHS : 1);
export const addonLabel = (kind, people, billing) =>
  `${kind === 'plus' ? 'PermitPal Plus' : kind === 'brand' ? 'White-label' : `Staff licences, up to ${people} people`} (${billing === 'yearly' ? 'yearly' : 'monthly'})`;
