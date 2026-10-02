// Public, read-only compliance summary opened from a share link (share.html#<token>).
// Shows only what the owner chose to share; the database checks the token and expiry.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { html, fmtDate, fmtDateTime } from './util.js';

const STATUS = {
  action_required: ['Overdue', 'overdue'], renew_soon: ['Renew soon', 'soon'], in_progress: ['In progress', 'progress'],
  needs_information: ['Needs info', 'needinfo'], compliant: ['Compliant', 'ok'],
};
const app = document.getElementById('app');
const token = decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim();

function fail(msg) {
  app.innerHTML = String(html`<div class="share-wrap"><section class="card"><div class="card-head"><h2>Compliance summary</h2></div>
    <p class="share-msg">${msg}</p></section></div>`);
}

async function main() {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) return fail('This link is incomplete. Ask the business to send it again.');
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('get_shared_compliance', { p_token: token });
  if (error) return fail('We could not load this summary. Please try again in a minute.');
  if (data.error) return fail(data.error);
  document.title = `${data.org_name} · compliance summary`;
  const groups = new Map();
  for (const it of data.items) {
    const key = it.subject === 'vehicle' ? `${it.subject_name}${it.plate_no ? ' · ' + it.plate_no : ''}`
      : it.location ? `${it.subject_name} · ${it.location}` : it.subject_name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const counts = Object.keys(STATUS).map((s) => [s, data.items.filter((i) => i.status === s).length]).filter(([, n]) => n);
  app.innerHTML = String(html`<div class="share-wrap">
    <header class="share-top"><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span>
      <button class="btn btn-ghost btn-sm no-print" id="print">Print or save as PDF</button></header>
    <section class="card">
      <div class="card-head"><h2>${data.org_name}</h2></div>
      <p class="card-sub">${data.label || 'Compliance summary'} · as of ${fmtDate(data.as_of)}</p>
      <div class="share-counts">${counts.map(([s, n]) => html`<span class="chip ${STATUS[s][1]}">${n} ${STATUS[s][0]}</span>`)}</div>
      ${[...groups].map(([name, items]) => html`<h3 class="share-group">${name}</h3>
        ${items.map((i) => html`<div class="line share-line"><div class="share-main"><b>${i.name}</b>
          <small>${i.expires ? (i.expires_on ? 'Valid until ' + fmtDate(i.expires_on) : 'No expiry date on file') : 'Does not expire'}${i.reference_no ? ' · No. ' + i.reference_no : ''}${i.issuer ? ' · ' + i.issuer : ''}${i.on_file ? ' · document on file' : ''}</small></div>
          <span class="chip ${STATUS[i.status]?.[1] || 'needinfo'}">${STATUS[i.status]?.[0] || 'Needs info'}</span></div>`)}`)}
      ${data.items.length ? '' : html`<p class="share-msg">Nothing to show yet.</p>`}
    </section>
    <p class="fineprint">Generated ${fmtDateTime(data.generated_at)} from the business's own PermitPal records. PermitPal does not issue or certify these documents; ask the business for the original permits if you need them. This link stops working on ${fmtDate(String(data.expires_at).slice(0, 10))}.</p>
  </div>`);
  document.getElementById('print').onclick = () => window.print();
}
main().catch(() => fail('We could not load this summary. Please try again in a minute.'));
