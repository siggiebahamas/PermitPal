// The website badge: the headline of a business's public permit page, live. Loading it isn't counted as a
// visit; clicking through to the page is (as "Website badge").
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const code = decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim().toLowerCase();
const a = document.getElementById('badge');
const set = (cls, title, sub) => {
  a.className = `pp-badge ${cls}`;
  a.querySelector('b').textContent = title;
  a.querySelector('small').textContent = sub;
  a.setAttribute('aria-label', `${title}. ${sub}. Opens the permit page.`);
};
const day = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

async function main() {
  if (!/^[a-z0-9]{8,16}$/.test(code)) { a.removeAttribute('href'); return set('', 'Permit page', 'Pinoy Permit'); }
  a.href = new URL(`p.html?c=${code}&s=badge`, location.href).href;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('trust_badge', { p_code: code });
  if (error || !data || data.state !== 'live') return set('', 'See our permits', 'Pinoy Permit');
  const checked = data.checked_at ? `checked ${day(data.checked_at)}` : 'checked daily';
  if (data.expired > 0) return set('expired', `${data.expired} permit${data.expired === 1 ? '' : 's'} expired`, `Pinoy Permit · ${checked}`);
  if (data.due > 0) return set('due', `${data.due} renewal${data.due === 1 ? '' : 's'} due`, `Pinoy Permit · ${checked}`);
  if (data.ok > 0 && data.pending === 0) return set('ok', `All ${data.ok} permits current`, `Pinoy Permit · ${checked}`);
  return set(data.ok > 0 ? 'ok' : '', `${data.ok} permit${data.ok === 1 ? '' : 's'} current`, `Pinoy Permit · ${checked}`);
}
main().catch(() => set('', 'See our permits', 'Pinoy Permit'));
