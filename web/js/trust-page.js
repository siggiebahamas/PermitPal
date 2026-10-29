// A business's public permit page (p.html?c=<code>), opened from a link, the QR poster, a badge or an
// update email. Shows each permit's status from the business's own records, checked automatically by
// Pinoy Permit; never claims a government check. Visitors can ask for updates; recipients can stop them.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { html, fmtDate, timeAgo } from './util.js';

const q = new URLSearchParams(location.search);
const code = (q.get('c') || '').trim().toLowerCase();
const src = q.get('s') || 'link';
const rcpt = /^[0-9a-f-]{36}$/i.test(q.get('r') || '') ? q.get('r') : null;
const app = document.getElementById('app');
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const home = new URL('./', location.href).href;
const STATE = { ok: ['Current', 'ok'], due: ['Renewal due soon', 'soon'], expired: ['Expired', 'overdue'], pending: ['Details being added', 'needinfo'] };
const label = (i) => (i.in_progress ? (i.state === 'expired' ? ['Expired · renewal in progress', 'overdue'] : ['Being renewed', 'progress']) : STATE[i.state] || STATE.pending);
const checkedWhen = (ts) => (Date.now() - Date.parse(ts) < 7 * 864e5 ? timeAgo(ts).toLowerCase() : `on ${fmtDate(String(ts).slice(0, 10))}`);
const brand = html`<img class="brand-wm" src="img/wordmark.png" alt="Pinoy Permit">`;

function shell(inner) {
  app.innerHTML = String(html`<div class="share-wrap">
    <header class="share-top"><a href="${home}" class="tp-brand" aria-label="Pinoy Permit home">${brand}</a>
      <button class="btn btn-ghost btn-sm no-print" id="print">Print</button></header>
    ${inner}
    <footer class="tp-foot no-print"><p>Pinoy Permit reminds businesses before their permits expire and keeps their papers in one place.
      <a href="${home}#/welcome">Make a page like this for your business</a></p></footer></div>`);
  document.getElementById('print')?.addEventListener('click', () => window.print());
}
// What a viewer must know: these are the business's own records, not checked with the government.
const notice = (report) => html`<section class="tp-notice" role="note"><b>Shown as the business entered it.</b> Pinoy Permit doesn't check permits with the government or confirm that copies are genuine. To be sure, ask to see the originals or check with the office that issued them.
  <a href="${report}">Report a problem with this page</a></section>`;
const fail = (title, msg) => shell(html`<section class="card"><div class="card-head"><h1>${title}</h1></div><p class="share-msg">${msg}</p></section>`);

async function main() {
  if (!/^[a-z0-9]{8,16}$/.test(code)) return fail('Permit page', 'This link is incomplete. Scan the code again, or ask the business for the link.');
  if (q.get('stop') === '1' && rcpt) return stopPage();
  const { data, error } = await sb.rpc('get_trust_page', { p_code: code, p_src: src, p_rcpt: rcpt });
  if (error) return fail('Permit page', 'We could not load this page. Please try again in a minute.');
  if (data.state === 'missing') return fail('Permit page', "This page doesn't exist or has moved. Ask the business for its current link.");
  if (data.state === 'paused') return fail(data.title || 'Permit page', 'This permit page is not available right now. Ask the business for their current permits.');
  document.title = `${data.title} · permits`;
  const items = data.items || [];
  const n = (s) => items.filter((i) => i.state === s).length;
  const head = n('expired') ? ['overdue', `${n('expired')} permit${n('expired') === 1 ? '' : 's'} expired`]
    : n('due') ? ['soon', `${n('due')} renewal${n('due') === 1 ? '' : 's'} due soon`]
    : n('ok') ? ['ok', n('pending') ? `${n('ok')} permits current` : `All ${n('ok')} permits current`] : ['needinfo', 'Permits being added'];
  const groups = new Map();
  for (const it of items) { const k = it.group || data.business; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  shell(html`
    <section class="card tp-head">
      <p class="tp-kicker">Permits of</p>
      <h1>${data.title}</h1>
      ${data.city ? html`<p class="muted">${data.city}</p>` : ''}
      ${data.intro ? html`<p>${data.intro}</p>` : ''}
      <p class="tp-state"><span class="chip lg ${head[0]}">${head[1]}</span></p>
      <p class="muted small">From ${data.title}'s own records, checked automatically by Pinoy Permit ${checkedWhen(data.checked_at)} · status as of ${fmtDate(data.as_of)}</p>
      ${data.recipient ? html`<p class="small">Hi ${data.recipient}: you get an email when they renew a permit. <a href="?c=${code}&r=${rcpt}&stop=1">Stop these emails</a></p>` : ''}
    </section>
    ${notice(`${home}#/contact?topic=other&about=${encodeURIComponent(location.href.split('#')[0])}`)}
    <section class="card">
      ${[...groups].map(([g, list]) => html`${groups.size > 1 ? html`<h3 class="share-group">${g}</h3>` : ''}
        ${list.map((i) => { const [t, cls] = label(i); return html`<div class="line share-line tp-line"><div class="share-main"><b>${i.name}</b>
          <small>${i.expires ? (i.expires_on ? `Valid until ${fmtDate(i.expires_on)}` : 'No expiry date on file') : 'Does not expire'}${i.issuer ? ` · ${i.issuer}` : ''}${i.ref ? ` · No. ${i.ref}` : ''}${i.on_file ? ' · copy on file' : ''}</small>
          ${(i.files || []).length ? html`<span class="tp-files">${i.files.map((f) => html`<button class="btn btn-sm btn-soft no-print" data-path="${f.path}" data-name="${f.name}">Download copy</button>`)}</span>` : ''}</div>
          <span class="chip ${cls}">${t}</span></div>`; })}`)}
      ${items.length ? '' : html`<p class="share-msg">No permits listed yet.</p>`}
      ${data.staff && data.staff.licences ? html`<div class="line share-line"><div class="share-main"><b>Staff licenses</b>
        <small>${data.staff.licences} for ${data.staff.people} ${data.staff.people === 1 ? 'person' : 'people'}: ${data.staff.ok} current${data.staff.due ? `, ${data.staff.due} due soon` : ''}${data.staff.expired ? `, ${data.staff.expired} expired` : ''}</small></div></div>` : ''}
    </section>
    ${data.recipient ? '' : html`<section class="card no-print" id="ask"><h2>Get an email when these are renewed</h2>
      <p class="muted small">For clients, malls and landlords. ${data.title} decides; you get nothing until they say yes.</p>
      <form id="ask-form" novalidate><div class="grid2">
        <label class="field"><span>Your name</span><input name="name" maxlength="120" required autocomplete="name"></label>
        <label class="field"><span>Company <small>(optional)</small></span><input name="company" maxlength="120" autocomplete="organization"></label></div>
        <label class="field"><span>Email</span><input type="email" name="email" maxlength="254" required autocomplete="email"></label>
        <label class="field"><span>Why <small>(optional)</small></span><input name="note" maxlength="300" placeholder="e.g. For your supplier accreditation"></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary">Ask for updates</button></form></section>`}
    <p class="fineprint">This page shows ${data.title}'s own records${data.business && data.business !== data.title ? ` for ${data.business}` : ''}; the business chooses which permits to list. Pinoy Permit checks them automatically every morning (for example, that each one has a copy and an expiry date) and shows them as they are. Pinoy Permit does not issue permits or verify them with the government: ask the business for the originals if you need them.</p>`);

  app.querySelectorAll('.tp-files [data-path]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    // Through the document vault (files are stored encrypted); files from before the vault have a plain link.
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/doc-vault?op=get&path=${encodeURIComponent(b.dataset.path)}`, { headers: { apikey: SUPABASE_KEY }, cache: 'no-store' });
      if (r.ok) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await r.blob()); a.download = `Copy - ${b.dataset.name || 'document'}`; document.body.appendChild(a); a.click(); a.remove();
        b.disabled = false; return;
      }
    } catch { /* fall back to the plain link */ }
    const { data: d, error: e } = await sb.storage.from('documents').createSignedUrl(b.dataset.path, 120, { download: b.dataset.name });
    b.disabled = false;
    if (e || !d?.signedUrl) return toast("That copy isn't available any more. The business may have turned downloads off.");
    location.href = d.signedUrl;
  }));
  const form = document.getElementById('ask-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const err = form.querySelector('.form-error');
    const bad = !String(f.name || '').trim() ? 'Enter your name.' : !/^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i.test(String(f.email || '').trim()) ? 'Enter a valid email address.' : '';
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    const { error: e2 } = await sb.rpc('trust_request_updates', { p_code: code, p_name: f.name.trim(), p_company: (f.company || '').trim() || null, p_email: f.email.trim(), p_note: (f.note || '').trim() || null });
    if (e2) { err.textContent = e2.message || 'Something went wrong. Please try again.'; err.hidden = false; btn.disabled = false; return; }
    document.getElementById('ask').innerHTML = String(html`<h2>Request sent</h2><p>${data.title} will decide. If they say yes, you'll get a welcome email, then an email each time they renew a permit.</p>`);
  });
}

// "Stop these emails": a button, not the link itself (email apps open links on their own to check them).
function stopPage() {
  shell(html`<section class="card"><h1>Stop update emails?</h1><p>You won't get emails about this business's permits any more.</p>
    <button class="btn btn-primary" id="stop">Stop the emails</button> <a class="btn btn-ghost" href="?c=${code}&r=${rcpt}">Keep them</a></section>`);
  document.getElementById('stop').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const { data, error } = await sb.rpc('trust_unsubscribe', { p_token: rcpt });
    e.target.closest('section').innerHTML = String(error ? html`<h1>Something went wrong</h1><p>Please try again in a minute.</p>`
      : html`<h1>Done</h1><p>${data ? "You won't get these emails any more." : 'You were already off the list.'}</p>`);
  });
}
function toast(m) {
  const t = document.getElementById('toast');
  t.textContent = m; t.className = 'toast show error';
  setTimeout(() => { t.className = 'toast'; }, 5000);
}
main().catch(() => fail('Permit page', 'We could not load this page. Please try again in a minute.'));
