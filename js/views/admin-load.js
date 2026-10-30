// Admin > Load: top-ups to confirm (GCash/bank), papers checks to answer before their deadline, what load
// buys and its prices, gifts (bonus load or texts) and paying unused paid load back to a customer.
// Every rule is enforced by the database; this page only asks it.
import { html, fmtDate, fmtDateTime, toast, toastError, when, peso, plural, openModal, confirmDialog } from '../util.js?v=fd3a394';
import { S, on, rerender, empty } from '../core.js?v=fd3a394';
import * as db from 'pp/data';

let openCheck = null; // the papers check being answered
let cache = { topups: [], checks: [], products: [], wallets: [], orgs: [] };
const dueWhen = (iso) => new Date(iso).toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
const STATE = [['ok', 'Looks right'], ['fix', 'Needs a fix'], ['missing', 'Missing'], ['na', "Not needed / can't tell"]];

export async function loadTab() {
  const [topups, checks, products, wallets] = await Promise.all([db.adminTopups(), db.adminPapersChecks(), db.loadProducts(), db.adminWallets()]);
  cache = { ...cache, topups, checks, products, wallets };
  if (openCheck) {
    const c = checks.find((x) => x.id === openCheck);
    if (c) return checkDetail(c, await db.adminPapersCheckDetail(c));
    openCheck = null;
  }
  const toCheck = topups.filter((t) => t.status === 'pending_verification');
  const waiting = checks.filter((c) => c.status === 'waiting').sort((a, b) => a.due_by.localeCompare(b.due_by));
  const late = waiting.filter((c) => new Date(c.due_by) < new Date(Date.now() + 3 * 3600e3));
  const answered = checks.filter((c) => c.status !== 'waiting').slice(0, 30);
  const held = wallets.reduce((t, w) => t + Number(w.paid_php || 0), 0);
  const bonus = wallets.reduce((t, w) => t + Number(w.bonus_php || 0), 0);
  return html`
    <div class="stats four">
      <div class="stat ${toCheck.length ? 'soon' : 'ok'}"><div class="stat-n">${toCheck.length}</div><div class="stat-l">Top-ups to confirm</div></div>
      <div class="stat ${late.length ? 'overdue' : waiting.length ? 'soon' : 'ok'}"><div class="stat-n">${waiting.length}</div><div class="stat-l">Papers checks waiting${late.length ? ` (${late.length} due within 3 hours)` : ''}</div></div>
      <div class="stat"><div class="stat-n">${peso(held)}</div><div class="stat-l">Paid load customers hold</div></div>
      <div class="stat"><div class="stat-n">${peso(bonus)}</div><div class="stat-l">Bonus load out (free)</div></div>
    </div>
    <section class="card"><div class="card-head"><div><h2>Papers checks to answer</h2>
      <p class="card-sub">Answer by the time shown, or the customer gets their load back automatically the next morning.</p></div></div>
      ${waiting.length ? waiting.map((c) => html`<button class="line" data-act="adm-papers" data-id="${c.id}"><span class="line-main"><b>${c.requirement_name} — ${c.subject_label}</b>
        <small>${c.orgs?.name || ''}${c.city ? ` · ${c.city}` : ''} · asked ${fmtDateTime(c.created_at)}${c.paid_with === 'pass' ? ' · season pass' : ` · ${peso(c.price_php)}`}</small></span>
        <span class="chip ${new Date(c.due_by) < new Date() ? 'overdue' : late.includes(c) ? 'soon' : 'progress'}">By ${dueWhen(c.due_by)}</span></button>`)
        : html`<p class="muted">Nothing waiting.</p>`}
    </section>
    <section class="card"><div class="card-head"><div><h2>Top-ups to confirm</h2>
      <p class="card-sub">Find each one in your GCash or bank app, then confirm. The load is added straight away.</p></div></div>
      ${toCheck.length ? toCheck.map((t) => html`<div class="line"><div class="line-main"><b>${t.orgs?.name || 'Workspace'}: ${peso(t.amount_php)}</b>
          <small>Top-up ${t.number} · ${String(t.pay_method || '').replace('_', ' ')}${t.pay_ref ? ` · ref ${t.pay_ref}` : ''} · ${fmtDateTime(t.reported_at)}</small></div>
        <div class="btn-row">${when(t.proof_path, html`<button class="btn btn-sm btn-ghost" data-act="staff-file" data-path="${t.proof_path}" data-name="${t.proof_name || 'proof'}">Screenshot</button>`)}
          <button class="btn btn-sm btn-primary" data-act="adm-topup-ok" data-id="${t.id}">Found it</button>
          <button class="btn btn-sm btn-ghost" data-act="adm-topup-no" data-id="${t.id}">Not found</button></div></div>`)
        : html`<p class="muted">Nothing to confirm.</p>`}
    </section>
    <section class="card"><div class="card-head"><div><h2>What load buys</h2><p class="card-sub">Change a price or switch something off. Customers see it at once; what they already bought is kept.</p></div></div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Load prices"><table class="table"><thead><tr><th>What</th><th>Price</th><th>On sale</th><th></th></tr></thead><tbody>
      ${products.map((p) => html`<tr><td><b>${p.name}</b>${p.texts ? html`<div class="muted small">${p.texts} texts</div>` : ''}</td>
        <td><input class="price-in" type="number" min="0" max="5000" step="1" value="${Number(p.price_php)}" data-price-for="${p.code}" aria-label="Price of ${p.name}"></td>
        <td><input type="checkbox" ${p.active ? 'checked' : ''} data-active-for="${p.code}" aria-label="${p.name} on sale"></td>
        <td><button class="btn btn-sm btn-soft" data-act="adm-load-price" data-code="${p.code}">Save</button></td></tr>`)}</tbody></table></div>
    </section>
    <section class="card"><div class="card-head"><div><h2>Gifts and paying load back</h2>
      <p class="card-sub">A gift is bonus load or texts (for a late answer, a launch partner). Paying back is for a customer who asks for their unused paid load.</p></div>
      <div class="btn-row"><button class="btn btn-sm btn-primary" data-act="adm-load-gift">Give</button><button class="btn btn-sm btn-ghost" data-act="adm-load-cashout">Pay back</button></div></div>
      ${wallets.filter((w) => Number(w.paid_php) || Number(w.bonus_php) || w.texts).length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Balances"><table class="table"><thead><tr><th>Workspace</th><th>Paid</th><th>Bonus</th><th>Texts</th></tr></thead><tbody>
        ${wallets.filter((w) => Number(w.paid_php) || Number(w.bonus_php) || w.texts).map((w) => html`<tr><td>${w.orgs?.name || ''}</td><td>${peso(w.paid_php)}</td><td>${peso(w.bonus_php)}</td><td>${w.texts}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">No balances yet.</p>`}
    </section>
    ${answered.length ? html`<details class="card"><summary><b>Answered and given back</b> <span class="muted small">latest ${answered.length}</span></summary>
      ${answered.map((c) => html`<div class="line"><div class="line-main"><b>${c.requirement_name} — ${c.subject_label}</b>
        <small>${c.orgs?.name || ''} · ${c.status === 'answered' ? `answered ${fmtDateTime(c.answered_at)}: ${c.verdict === 'ready' ? 'ready' : c.verdict === 'almost' ? 'almost' : 'not ready'}` : `${c.status} ${fmtDateTime(c.refunded_at || c.created_at)}${c.refund_reason ? `: ${c.refund_reason}` : ''}`}</small></div>
        ${when(c.status === 'answered', html`<button class="btn btn-sm btn-ghost" data-act="adm-papers-back" data-id="${c.id}">Give it back</button>`)}</div>`)}</details>` : ''}`;
}

// One papers check: the customer's photos and the permit's files, then each checklist line.
function checkDetail(c, d) {
  const type = S.data?.types?.find((t) => t.code === d.req?.type_code);
  const items = (Array.isArray(type?.checklist) && type.checklist.length ? type.checklist : []).map((i) => ({ k: i.k, t: i.t }));
  return html`<button class="back linklike" data-act="adm-papers-close">← All papers checks</button>
    <section class="card"><div class="card-head"><div><h2>${c.requirement_name} — ${c.subject_label}</h2>
      <p class="card-sub">${c.orgs?.name || ''}${c.city ? ` · ${c.city}` : ''} · asked ${fmtDateTime(c.created_at)} · answer by <b>${dueWhen(c.due_by)}</b></p></div>
      <button class="btn btn-sm btn-ghost" data-act="adm-papers-back" data-id="${c.id}">Give it back</button></div>
      ${when(c.note, html`<p class="help-text">Customer's note: ${c.note}</p>`)}
      <h3 class="h4">Photos they sent (${d.files.length})</h3>
      ${d.files.length ? html`<div class="btn-row wrap">${d.files.map((f) => html`<button class="btn btn-sm btn-soft" data-act="staff-file" data-path="${f.storage_path}" data-name="${f.file_name}">${f.file_name}</button>`)}</div>` : html`<p class="muted small">None: check the permit's own files below.</p>`}
      <h3 class="h4">Files already on the permit (${d.docs.length})</h3>
      ${d.docs.length ? html`<div class="btn-row wrap">${d.docs.map((f) => html`<button class="btn btn-sm btn-ghost" data-act="staff-file" data-path="${f.storage_path}" data-name="${f.file_name}">${f.file_name}</button>`)}</div>` : html`<p class="muted small">None.</p>`}
      <p class="muted small">Every file you open is listed for the customer under Settings.</p>
    </section>
    <form class="card" id="papers-answer" data-id="${c.id}" novalidate>
      <h2>Your answer</h2>
      ${items.length ? items.map((i, n) => html`<fieldset class="pc-line"><legend>${i.t}</legend><input type="hidden" name="k${n}" value="${i.k}"><input type="hidden" name="t${n}" value="${i.t}">
        <div class="pc-states">${STATE.map(([v, l]) => html`<label class="pick-chip"><input type="radio" name="s${n}" value="${v}" required><span>${l}</span></label>`)}</div>
        <label class="field"><span>Note for the customer <small>(optional)</small></span><input name="n${n}" maxlength="500" placeholder="e.g. The lease is for the old unit: bring the new one."></label></fieldset>`)
        : html`<p class="muted small">This permit has no checklist in the library: write what you found in the summary.</p>`}
      <input type="hidden" name="count" value="${items.length}">
      <label class="field"><span>Overall</span><select name="verdict" required><option value="">Choose…</option><option value="ready">Ready to file</option><option value="almost">Almost there: a few fixes</option><option value="not_ready">Not ready yet: papers missing</option></select></label>
      <label class="field"><span>Summary for the customer</span><textarea name="summary" rows="3" maxlength="2000" required placeholder="What to do before they go, in plain words."></textarea></label>
      <div class="btn-row"><button class="btn btn-primary">Send the answer</button></div>
    </form>`;
}

on('adm-papers', (ds) => { openCheck = ds.id; rerender(); });
on('adm-papers-close', () => { openCheck = null; rerender(); });
on('adm-papers-back', (ds) => {
  openModal('Give the papers check back', html`<p class="muted small">The customer gets their load back (or their season pass's check), with your note.</p>
    <label class="field"><span>Why <small>(the customer sees this)</small></span><input name="note" maxlength="300" required value="Sorry, we couldn't check this one properly."></label>`, {
    submitLabel: 'Give it back', danger: false,
    onSubmit: async (fd) => { await db.adminRefundPapersCheck(ds.id, String(fd.get('note') || '').trim()); openCheck = null; toast('Given back.'); rerender(); },
  });
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest?.('#papers-answer');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  const n = Number(fd.get('count'));
  const items = [];
  for (let i = 0; i < n; i++) {
    const state = fd.get(`s${i}`);
    if (!state) return toast('Answer every line first.', 'error');
    items.push({ k: fd.get(`k${i}`), t: fd.get(`t${i}`), state, note: String(fd.get(`n${i}`) || '').trim() || null });
  }
  if (!fd.get('verdict')) return toast('Choose the overall answer.', 'error');
  const btn = f.querySelector('button');
  btn.disabled = true;
  try { await db.adminAnswerPapersCheck(f.dataset.id, fd.get('verdict'), items, String(fd.get('summary') || '').trim()); openCheck = null; toast('Sent. The customer is told now.'); rerender(); }
  catch (err) { toastError(err); btn.disabled = false; }
});

on('adm-topup-ok', (ds) => {
  openModal('Payment found', html`<p class="muted small">The load is added now, and the customer gets a thank-you with their new balance.</p>
    <label class="field"><span>BIR invoice / receipt number <small>(optional, add later under Money)</small></span><input name="no" maxlength="60"></label>`, {
    submitLabel: 'Confirm', danger: false,
    onSubmit: async (fd) => { await db.adminConfirmTopup(ds.id, true, null, String(fd.get('no') || '').trim()); toast('Confirmed. The load is in.'); rerender(); },
  });
});
on('adm-topup-no', (ds) => {
  openModal("Couldn't find the payment", html`<label class="field"><span>What to tell the customer</span><input name="note" maxlength="300" value="We could not find this payment. Please check the reference number and send it again."></label>`, {
    submitLabel: 'Send', danger: false,
    onSubmit: async (fd) => { await db.adminConfirmTopup(ds.id, false, String(fd.get('note') || '').trim()); toast('Sent back to the customer.'); rerender(); },
  });
});
on('adm-load-price', async (ds) => {
  const price = Number(document.querySelector(`[data-price-for="${ds.code}"]`)?.value);
  const active = !!document.querySelector(`[data-active-for="${ds.code}"]`)?.checked;
  try { await db.adminSaveLoadProduct(ds.code, price, active); toast('Saved.'); rerender(); } catch (e) { toastError(e); }
});
async function orgOptions() {
  if (!cache.orgs.length) { try { cache.orgs = await db.adminOrgs(); } catch { cache.orgs = []; } }
  return cache.orgs.map((o) => html`<option value="${o.id}">${o.name}</option>`);
}
on('adm-load-gift', async () => {
  const opts = await orgOptions();
  openModal('Give load or texts', html`
    <label class="field"><span>Workspace</span><select name="org" required><option value="">Choose…</option>${opts}</select></label>
    <div class="grid2"><label class="field"><span>Bonus load (₱)</span><input type="number" name="amount" min="0" max="5000" step="1" value="0"></label>
      <label class="field"><span>Texts</span><input type="number" name="texts" min="0" max="1000" step="1" value="0"></label></div>
    <label class="field"><span>Why <small>(the customer sees this)</small></span><input name="note" maxlength="200" required placeholder="e.g. Sorry for the late answer on your papers check."></label>
    <p class="muted small">Bonus load is used before paid load and can't be paid out.</p>`, {
    submitLabel: 'Give', danger: false,
    onSubmit: async (fd) => { await db.adminLoadGift(fd.get('org'), Number(fd.get('amount') || 0), Number(fd.get('texts') || 0), String(fd.get('note') || '').trim()); toast('Given. The customer is told.'); rerender(); },
  });
});
on('adm-load-cashout', async () => {
  const opts = await orgOptions();
  openModal('Pay load back', html`
    <p class="muted small">Only paid load that's unused. Send the money first, then record it here.</p>
    <label class="field"><span>Workspace</span><select name="org" required><option value="">Choose…</option>${opts}</select></label>
    <div class="grid2"><label class="field"><span>Amount (₱)</span><input type="number" name="amount" min="1" max="5000" step="1" required></label>
      <label class="field"><span>Sent by</span><select name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label></div>
    <label class="field"><span>Reference number</span><input name="ref" maxlength="120"></label>
    <label class="field"><span>Note <small>(optional)</small></span><input name="note" maxlength="200" placeholder="e.g. Closing the account"></label>`, {
    submitLabel: 'Record', danger: false,
    onSubmit: async (fd) => { await db.adminLoadCashout(fd.get('org'), Number(fd.get('amount')), fd.get('method'), String(fd.get('ref') || '').trim(), String(fd.get('note') || '').trim()); toast('Recorded.'); rerender(); },
  });
});
export const loadTabEmpty = () => empty('Not available yet', 'Pinoy Permit load switches on with database file 9.');
