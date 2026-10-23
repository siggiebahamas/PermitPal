// The most a city may add for a late Mayor's Permit renewal. The Local Government Code (RA 7160, Sec. 168)
// caps the surcharge at 25% of the unpaid amount, and interest at 2% a month of the unpaid amount including
// the surcharge, for at most 36 months. Cities may charge less, never more - so this is an upper limit.
// No imports: the public renewal guides (renew/) use it without loading the app.
export function maxPenalty(base, months) {
  const b = Math.max(0, Number(base) || 0);
  const m = Math.min(36, Math.max(0, Math.ceil(Number(months) || 0)));
  const surcharge = b * 0.25;
  const interest = (b + surcharge) * 0.02 * m;
  return { surcharge, interest, total: surcharge + interest, months: m };
}
