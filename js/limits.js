// How much room the workspace's plan has (from public.plan_usage, loaded with the workspace). The database refuses
// anything past the limit; this only shows it early and points to the plans. Nothing is ever hidden or deleted.
import { html, openModal } from './util.js?v=fd3a394';
import { S, go } from './core.js?v=fd3a394';

const word = (what, n) => (what === 'vehicle' ? (n === 1 ? 'vehicle' : 'vehicles') : n === 1 ? 'business' : 'businesses');
// { ok, line, full } for adding one more business or vehicle.
export function roomFor(what) {
  const u = S.data?.usage;
  if (!u) return { ok: true, line: '' };
  const lim = what === 'vehicle' ? u.vehicle_limit : u.business_limit;
  const have = Number(what === 'vehicle' ? u.vehicles : u.businesses);
  const total = Number(u.businesses) + Number(u.vehicles);
  if (u.record_limit != null && total >= u.record_limit) return { ok: false, line: `${total} of ${u.record_limit} businesses and vehicles on ${u.name}`, why: `Your ${u.name} plan tracks up to ${u.record_limit} businesses and vehicles together${lim != null ? ` (${lim} ${word(what, lim)})` : ''}.` };
  if (lim != null && have >= lim) return { ok: false, line: `${have} of ${lim} ${word(what, lim)} on ${u.name}`, why: `Your ${u.name} plan tracks up to ${lim} ${word(what, lim)}.` };
  if (u.record_limit != null) return { ok: true, line: `${total} of ${u.record_limit} businesses and vehicles on ${u.name}` };
  if (lim != null) return { ok: true, line: `${have} of ${lim} ${word(what, lim)} on ${u.name}` };
  return { ok: true, line: '' };
}
export const roomLine = (what) => { const r = roomFor(what); return r.line ? html`<span class="room-line ${r.ok ? '' : 'full'}">${r.line}</span>` : ''; };
// Before opening the "add" form: if the plan is full, say so and offer the plans instead.
export function guardRoom(what, open) {
  const r = roomFor(what);
  if (r.ok) return open();
  openModal('Your plan is full', html`<p><b>${r.why}</b> Everything you track now stays, and you can still edit it.</p>
    <p>To add another ${what}, move up to a bigger plan: Plus tracks up to 5, Core up to 15, and the fleet plans 16 to 150 vehicles.</p>
    <p class="muted small">Plans are tracking and planning software only. Hands-on renewal help is a separate service.</p>`, {
    submitLabel: 'See plans', cancelLabel: 'Not now', onSubmit: () => { setTimeout(() => go('#/settings/billing'), 30); },
  });
}
