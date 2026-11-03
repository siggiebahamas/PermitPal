// What a vehicle needs depends on more than its type: what it runs on, what it's used for, and whether it is still
// in the seller's name. The database applies the same rules (private.vehicle_rule) whenever these change, adding
// what now applies and removing what no longer does (only if nothing was recorded for it yet).
export const FUELS = [['gas', 'Gasoline'], ['diesel', 'Diesel'], ['hybrid', 'Hybrid'], ['electric', 'Fully electric']];
export const USES = [
  ['private', 'Private use'],
  ['company', 'Company use, not for hire'],
  ['for_hire_people', 'For hire: passengers (taxi, TNVS, jeepney, bus, tricycle)'],
  ['for_hire_goods', 'For hire: goods (truck or van for hire)'],
];
const forHire = (use) => use === 'for_hire_people' || use === 'for_hire_goods';

// true: needed; false: doesn't apply; null: the usual rules decide (every vehicle has it).
export function vehicleRule(code, { vehicle_type: type = 'Sedan', fuel = 'gas', usage = 'private', transfer_pending = false } = {}) {
  switch (code) {
    case 'emission_test': return fuel !== 'electric';                       // no exhaust, no smoke test
    case 'ltfrb_franchise': return forHire(usage) && type !== 'Tricycle';    // tricycles are franchised by the city
    case 'pa_insurance': return usage === 'for_hire_people';                 // passenger accident insurance
    case 'tricycle_franchise': return type === 'Tricycle' && forHire(usage); // the city's MTOP
    case 'transfer_ownership': return !!transfer_pending;
    default: return null;
  }
}
export const RULED = ['emission_test', 'ltfrb_franchise', 'pa_insurance', 'tricycle_franchise', 'transfer_ownership'];
// In plain words, for the vehicle page: why this vehicle has (or skips) a permit.
export function ruleNote(v) {
  const notes = [];
  if (v.fuel === 'electric') notes.push('Fully electric: no emission test needed.');
  if (forHire(v.usage)) notes.push(v.vehicle_type === 'Tricycle' ? "For hire: needs the city's tricycle franchise (MTOP)." : 'For hire: needs an LTFRB franchise.');
  if (v.usage === 'for_hire_people') notes.push('Carries passengers: needs passenger accident insurance.');
  if (v.transfer_pending) notes.push("Still in the seller's name: transfer it at LTO soon.");
  return notes;
}
