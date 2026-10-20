// Staff licences, beyond the list: the people limit, who isn't cleared to work, photos workers sent
// from their own link (checked by HR before they count), the link itself, licences by role, the
// worker's email and mobile for their own reminders, and a zip of everyone's licences.
import { html, openModal, toast, toastError, when, plural, fmtDate, todayPH, download, formObject } from '../util.js';
import { S, on, reload, canEdit, isOrgAdmin, has, person, reqsOf, typeOf, plusOf, peopleCap } from '../core.js';
import { ICON, STATUS, subjectLabel } from '../components.js';
import { seatLine, openSeatLimit } from './plus.js';
import { makeZip } from '../zip.js';
import * as db from 'pp/data';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'them';
const personReqs = () => S.data.reqs.filter((r) => r.subject === 'person');
const isPaused = (p) => !!p?.paused_at;

// ---------------------------------------------------------------- top of the People page
export function staffTop() {
  if (!has('plus')) return '';
  const subs = plusOf().submissions || [];
  const people = S.data.people || [];
  const lapsed = personReqs().filter((r) => r.status === 'action_required' && !isPaused(person(r.person_id)));
  const byPerson = new Map();
  for (const r of lapsed) { if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, []); byPerson.get(r.person_id).push(r); }
  return html`${seatLine()}
    ${when(subs.length && canEdit(), html`<section class="card worker-subs"><div class="card-head"><div><h2>Licences to check</h2>
        <p class="card-sub">Sent by your people from their own link. They count once you approve them.</p></div></div>
      ${subs.map((s) => { const p = person(s.person_id); const r = S.data.reqs.find((x) => x.id === s.requirement_id);
        return html`<div class="line"><div class="line-main"><b>${p?.full_name || 'Someone'}: ${r?.name || 'licence'}</b>
          <small>Sent ${fmtDate(s.created_at.slice(0, 10))}${s.expires_on ? ` · new expiry ${fmtDate(s.expires_on)}` : ''}${s.note ? ` · “${s.note}”` : ''}</small></div>
          <button class="btn btn-sm btn-primary" data-act="wsub-open" data-id="${s.id}">Check it</button></div>`; })}</section>`)}
    ${when(byPerson.size, html`<section class="card not-cleared"><div class="card-head"><div><h2>Not cleared to work</h2>
        <p class="card-sub">A licence they need has expired. Check before giving them work that needs it.</p></div></div>
      ${[...byPerson].map(([pid, rs]) => html`<a class="line" href="#/people/${pid}"><span class="line-main"><b>${person(pid)?.full_name}</b>
        <small>${rs.map((r) => `${r.name}: expired ${fmtDate(r.expires_on)}`).join(' · ')}</small></span>${ICON.chevron || ''}</a>`)}</section>`)}
    ${when(people.length, html`<div class="btn-row staff-tools">
      ${when(canEdit(), html`<button class="btn btn-sm btn-ghost" data-act="staff-roles">Licences by role</button>`)}
      <button class="btn btn-sm btn-ghost" data-act="staff-pack">${ICON.download} Everyone's licences (.zip)</button></div>`)}`;
}

// ---------------------------------------------------------------- on a person's page
export function personBanner(p) {
  if (!has('plus') || !isPaused(p)) return '';
  return html`<div class="banner warn"><div><b>Paused.</b> Reminders for ${first(p.full_name)}'s licences are off because your staff licences don't cover them. Nothing was deleted.</div>
    ${when(isOrgAdmin(), html`<a class="btn btn-sm btn-primary" href="#/settings/billing?staff=1">Add licences</a>`)}</div>`;
}
export function askCard(p) {
  if (!has('plus') || !canEdit() || isPaused(p)) return '';
  const reqs = reqsOf('person', p.id).filter((r) => r.expires);
  if (!reqs.length) return '';
  const pick = reqs.slice().sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999))[0];
  return html`<section class="card ask-card"><div class="card-head"><div><h2>Ask ${first(p.full_name)} for the renewed licence</h2>
      <p class="card-sub">${p.email ? `We email ${first(p.full_name)} 30 and 7 days before each licence expires, with this link.` : `Add ${first(p.full_name)}'s email under Details and we'll remind them too.`}
      They send a photo and the new dates, no account needed; you check it here before it counts.</p></div></div>
    <div class="proof-pick"><select id="ask-req" aria-label="Which licence">${reqs.map((r) => html`<option value="${r.id}" ${r.id === pick.id ? 'selected' : ''}>${r.name}${r.expires_on ? ` (expires ${fmtDate(r.expires_on)})` : ''}</option>`)}</select>
      <button class="btn btn-primary" data-act="wlink" data-person="${p.id}">${ICON.share} Get their link</button></div></section>`;
}
export function contactFields(p) {
  if (!has('plus')) return '';
  return html`<h3 class="h4">Their own reminders <small class="muted">(optional)</small></h3>
    <div class="grid2">
      <label class="field"><span>Email</span><input type="email" name="email" maxlength="254" value="${p.email || ''}" placeholder="name@example.com"></label>
      <label class="field"><span>Mobile</span><input name="mobile" maxlength="20" value="${p.mobile || ''}" placeholder="0917 123 4567" inputmode="tel"></label>
    </div>
    <label class="check"><input type="checkbox" name="remind_worker" ${p.remind_worker !== false ? 'checked' : ''}> <span>Email ${first(p.full_name)} before their licences expire, with a link to send the renewed one</span></label>`;
}
// Saves the contact part of the Details form (only when the database has it).
export async function saveContact(p, f) {
  if (!has('plus')) return;
  const email = String(f.email || '').trim();
  if (email && !/^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i.test(email)) throw new Error('Please enter a valid email address.');
  const mobile = String(f.mobile || '').trim();
  if (mobile && !/^[0-9+() -]{7,20}$/.test(mobile)) throw new Error('Please enter the mobile number with digits only, like 0917 123 4567.');
  await db.updatePersonContact(p.id, { email: email || null, mobile: mobile || null, remind_worker: f.remind_worker === 'on' });
}

// The link to send (Viber, Messenger, SMS, email): shown, copied, or shared with the phone's share sheet.
on('wlink', async (ds) => {
  const p = person(ds.person);
  const reqId = document.getElementById('ask-req')?.value;
  const r = S.data.reqs.find((x) => x.id === reqId);
  if (!p || !r) return;
  try {
    const tok = await db.workerLink(r.id);
    const url = new URL(`#/w/${tok}`, location.href.split('#')[0]).href;
    const msg = `Hi ${first(p.full_name)}, please send a photo of your renewed ${r.name} here (no account needed): ${url}`;
    openModal(`Send this to ${first(p.full_name)}`, html`
      <p class="muted small">Works for 45 days, once. Anyone with the link can send a photo for this licence only, and you check it before it counts.</p>
      <label class="field"><span>Message</span><textarea rows="4" readonly class="copy-box">${msg}</textarea></label>
      <div class="btn-row"><button type="button" class="btn btn-primary" data-copy>${ICON.copy || ''} Copy</button>
        ${when(navigator.share, html`<button type="button" class="btn btn-soft" data-share>${ICON.share} Share</button>`)}
        ${when(p.email, html`<a class="btn btn-ghost" href="mailto:${p.email}?subject=${encodeURIComponent(`Your ${r.name}`)}&body=${encodeURIComponent(msg)}">Email it</a>`)}</div>`, {
      onOpen: (form) => {
        form.querySelector('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(msg); toast('Copied.'); } catch { form.querySelector('textarea').select(); } });
        form.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ text: msg }).catch(() => {}));
      },
    });
  } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- checking a photo a worker sent
on('wsub-open', async (ds) => {
  const s = (plusOf().submissions || []).find((x) => x.id === ds.id);
  if (!s) return;
  const p = person(s.person_id);
  const r = S.data.reqs.find((x) => x.id === s.requirement_id);
  let url = null;
  try { url = await db.fileUrl(s.storage_path); } catch { /* shown as a link-less note */ }
  const isImg = /^image\//.test(s.mime_type || '');
  openModal(`${p?.full_name || 'Someone'}: ${r?.name || 'licence'}`, html`
    ${url ? (isImg ? html`<a href="${url}" target="_blank" rel="noopener"><img class="wsub-img" src="${url}" alt="Photo ${p?.full_name || ''} sent"></a>`
      : html`<p><a class="btn btn-soft" href="${url}" target="_blank" rel="noopener">Open the file</a></p>`) : html`<p class="muted">The file couldn't be opened. Try again in a minute.</p>`}
    <p class="muted small">Check the photo matches these details before you approve. Fix anything that's wrong.</p>
    <div class="grid2">
      <label class="field"><span>Expiry date</span><input type="date" name="expires_on" value="${s.expires_on || ''}" ${r?.expires ? 'required' : ''}></label>
      <label class="field"><span>Issued <small>(optional)</small></span><input type="date" name="issued_on" value="${s.issued_on || ''}"></label>
    </div>
    <label class="field"><span>Licence number <small>(optional)</small></span><input name="reference_no" maxlength="100" value="${s.reference_no || ''}"></label>
    <details class="send-back"><summary>Something wrong with it?</summary>
      <label class="field"><span>Tell ${first(p?.full_name)} what to fix</span><input name="note" maxlength="300" placeholder="e.g. The photo is blurry; the date is cut off"></label>
      <button type="button" class="btn btn-ghost" data-reject>Send it back${p?.email ? ' (we email them a new link)' : ''}</button></details>`, {
    submitLabel: 'Approve: it counts now',
    danger: false,
    onOpen: (form) => form.querySelector('[data-reject]').addEventListener('click', async () => {
      const note = form.querySelector('[name=note]').value.trim();
      if (!note) { form.querySelector('[name=note]').focus(); return toast('Say what to fix, so they can send a better one.', 'error'); }
      try { await db.workerDecide(s.id, false, { note }); document.querySelector('[data-modal-close]')?.click(); await reload(); toast(p?.email ? `Sent back. ${first(p.full_name)} gets an email with a new link.` : 'Sent back. Send them a new link from their page.'); } catch (e) { toastError(e); }
    }),
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (f.issued_on && f.expires_on && f.issued_on > f.expires_on) throw new Error('The issue date is after the expiry date.');
      await db.workerDecide(s.id, true, f);
      await reload();
      toast(`Saved: ${p?.full_name || 'their'} ${r?.name || 'licence'} now shows the new dates.`);
    },
  });
});

// ---------------------------------------------------------------- licences by role
on('staff-roles', () => {
  const types = S.data.types.filter((t) => t.subject === 'person');
  const roles = plusOf().roles || [];
  const titles = [...new Set((S.data.people || []).map((p) => p.role_title).filter(Boolean))];
  const missing = (role) => (S.data.people || []).filter((p) => p.role_title?.trim().toLowerCase() === role.name.trim().toLowerCase()
    && role.type_codes.some((c) => !reqsOf('person', p.id).some((r) => r.type_code === c)));
  openModal('Licences by role', html`
    <p class="muted small">Say which licences each role needs. New people in that role get them added, and the permit check points out anyone missing one.</p>
    ${roles.length ? roles.map((ro) => { const m = missing(ro); return html`<div class="line role-line"><div class="line-main"><b>${ro.name}</b>
        <small>${ro.type_codes.map((c) => typeOf(c)?.name || c).join(', ') || 'No licences'}${m.length ? ` · ${plural(m.length, 'person is', 'people are')} missing one` : ''}</small></div>
      <div class="btn-row">${when(m.length, html`<button type="button" class="btn btn-sm btn-primary" data-role-apply="${ro.id}">Add to ${plural(m.length, 'person', 'people')}</button>`)}
        <button type="button" class="btn btn-sm btn-ghost" data-role-del="${ro.id}" aria-label="Remove the ${ro.name} role">Remove</button></div></div>`; })
      : html`<p class="muted">No roles yet.</p>`}
    <h3 class="h4">Add or change a role</h3>
    <label class="field"><span>Role</span><input name="role" maxlength="80" list="role-titles" placeholder="e.g. Cook, Driver, Security guard" required>
      <datalist id="role-titles">${titles.map((t) => html`<option value="${t}"></option>`)}</datalist></label>
    ${types.map((t) => html`<label class="check"><input type="checkbox" name="types" value="${t.code}"> <span>${t.name}</span></label>`)}`, {
    submitLabel: 'Save role',
    onOpen: (form) => {
      form.querySelectorAll('[data-role-apply]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try { const n = await db.applyStaffRole(b.dataset.roleApply); await reload(); toast(n ? `Added ${plural(n, 'licence')}. Now add each one's expiry date.` : 'Everyone already has them.'); document.querySelector('[data-modal-close]')?.click(); } catch (e) { toastError(e); b.disabled = false; }
      }));
      form.querySelectorAll('[data-role-del]').forEach((b) => b.addEventListener('click', async () => {
        try { await db.deleteStaffRole(b.dataset.roleDel); await reload(); b.closest('.role-line').remove(); toast('Removed. Nobody\'s licences were changed.'); } catch (e) { toastError(e); }
      }));
      const roleInput = form.querySelector('[name=role]');
      roleInput.addEventListener('input', () => {
        const ro = roles.find((x) => x.name.trim().toLowerCase() === roleInput.value.trim().toLowerCase());
        if (ro) form.querySelectorAll('[name=types]').forEach((c) => { c.checked = ro.type_codes.includes(c.value); });
      });
    },
    onSubmit: async (fd) => {
      const name = String(fd.get('role') || '').trim();
      const picked = fd.getAll('types');
      if (!picked.length) throw new Error('Tick at least one licence for this role.');
      await db.saveStaffRole(S.org.id, name, picked);
      await reload();
      toast(`Saved. People who are ${name} need: ${picked.map((c) => typeOf(c)?.name || c).join(', ')}.`);
    },
  });
});
// The role's licences, for the add-a-person form.
export const roleTypes = (title) => (plusOf().roles || []).find((r) => r.name.trim().toLowerCase() === String(title || '').trim().toLowerCase())?.type_codes || null;
export const canAddPerson = () => !has('plus') || (S.data.people || []).length < peopleCap();
export function blockedAddPerson() {
  const n = (S.data.people || []).length;
  openSeatLimit(`You're tracking ${plural(n, 'person', 'people')}, the most your plan covers right now.`);
}

// ---------------------------------------------------------------- everyone's licences in one zip
on('staff-pack', async (ds, btn) => {
  const reqs = personReqs();
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80).trim();
  btn.disabled = true;
  const was = btn.innerHTML;
  btn.textContent = 'Preparing…';
  try {
    const docs = (await db.orgDocuments(S.org.id)).filter((d) => reqs.some((r) => r.id === d.requirement_id && r.cycle_id === d.cycle_id));
    if (!docs.length) throw new Error('No current licence copies uploaded yet.');
    const files = [];
    const used = new Set();
    for (const d of docs) {
      const r = reqs.find((x) => x.id === d.requirement_id);
      let name = `${clean(subjectLabel(r))}/${clean(r.name)} - ${clean(d.file_name)}`;
      while (used.has(name)) name = name.replace(/(\.[^.]*)?$/, '-2$1');
      used.add(name);
      let blob;
      try { blob = await db.fileBlob(d.storage_path); } catch { throw new Error(`Couldn't download ${d.file_name}. Please try again.`); }
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const rows = reqs.slice().sort((a, b) => (a.subject_name || '').localeCompare(b.subject_name || '') || a.name.localeCompare(b.name));
    const summary = String(html`<!doctype html><html><head><meta charset="utf-8"><title>Staff licences</title>
      <style>body{font-family:system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:14px}</style></head><body>
      <h1>${S.org.name}: staff licences</h1><p>As of ${fmtDate(todayPH())} · prepared with PermitPal</p>
      <table><tr><th>Person</th><th>Role</th><th>Licence</th><th>Status</th><th>No.</th><th>Expires</th><th>Copy</th></tr>
      ${rows.map((r) => html`<tr><td>${r.subject_name}</td><td>${r.person_role || ''}</td><td>${r.name}</td><td>${STATUS[r.status].label}</td><td>${r.reference_no || '—'}</td>
        <td>${r.expires ? (r.expires_on ? fmtDate(r.expires_on) : '—') : 'Does not expire'}</td><td>${r.document_count ? 'Included' : 'Missing'}</td></tr>`)}</table></body></html>`);
    files.unshift({ name: '00 Summary.html', data: new TextEncoder().encode(summary) });
    download(`${clean(S.org.name)} - staff licences ${todayPH()}.zip`, makeZip(files), 'application/zip');
    toast(`Ready: ${plural(docs.length, 'file')}.`);
  } catch (e) { toastError(e); }
  btn.disabled = false;
  btn.innerHTML = was;
});

