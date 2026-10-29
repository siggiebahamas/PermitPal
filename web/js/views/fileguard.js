// Who can open a workspace's files (database file 20). The owner can switch on "Ask me first": teammates then need
// an OK from the owner or an admin to open a permit's files, for 24 hours or 7 days. Storage enforces it; this page
// only shows it. Owners and admins also see who opened which file, and when.
import { html, toast, toastError, when, fmtDateTime, timeAgo, openModal } from '../util.js';
import { S, on, has, isOwner, isOrgAdmin, reqById, rerender } from '../core.js';
import { ICON } from '../components.js';
import * as db from 'pp/data';

let state = null; // { org, mode, alerts, role, mine, pending, opens }
export async function loadFileAccess(force = false) {
  if (!has('fileguard') || !S.org) return null;
  if (!force && state?.org === S.org.id) return state;
  try { state = { org: S.org.id, ...(await db.fileAccessState(S.org.id)) }; } catch { state = null; }
  return state;
}
const admin = () => ['owner', 'admin'].includes(state?.role);
const grantFor = (reqId) => (state?.mine || []).find((g) => g.requirement_id === reqId);
// 'open' | 'pending' | 'locked' | { until }
export function fileAccess(reqId) {
  if (!state || state.mode !== 'ask' || admin()) return 'open';
  const g = grantFor(reqId);
  if (g?.status === 'approved' && g.expires_at > new Date().toISOString()) return { until: g.expires_at };
  return g?.status === 'pending' ? 'pending' : 'locked';
}

// On a permit page: what a teammate sees while files are locked.
export function lockBox(r) {
  const a = fileAccess(r.id);
  if (a === 'open') return '';
  if (a.until) return html`<p class="file-lock open">${ICON.check}<span>You can open these files until <b>${fmtDateTime(a.until)}</b>. The owner sees each file you open.</span></p>`;
  return html`<div class="file-lock">${ICON.lock || ''}<span><b>Files are locked.</b> ${a === 'pending' ? "You asked to open them. You'll get a notification when the owner answers."
    : 'Your workspace owner keeps files private. Ask, and they can let you open them for 24 hours or 7 days.'}</span>
    ${when(a === 'locked', html`<button class="btn btn-soft btn-sm" data-act="file-ask" data-id="${r.id}">Ask to open</button>`)}</div>`;
}

// Settings > Workspace: the switch, the requests waiting, and who opened what.
export function fileGuardCard() {
  if (!state || !admin()) return '';
  const owner = isOwner();
  return html`<section class="card file-guard" id="file-guard"><div class="card-head"><div><h2>Who can open your files</h2>
      <p class="card-sub">Permits, registrations and IDs are sensitive. Decide who on your team can open them, and see every time someone does.</p></div></div>
    <form id="file-guard-form">
      <label class="radio-card ${state.mode === 'open' ? 'on' : ''}"><input type="radio" name="mode" value="open" ${state.mode === 'open' ? 'checked' : ''} ${owner ? '' : 'disabled'}>
        <span><b>Everyone on my team</b><small>Owners, admins and teammates can open any file.</small></span></label>
      <label class="radio-card ${state.mode === 'ask' ? 'on' : ''}"><input type="radio" name="mode" value="ask" ${state.mode === 'ask' ? 'checked' : ''} ${owner ? '' : 'disabled'}>
        <span><b>Ask me first</b><small>Teammates see the list of files, but need your OK to open them: for one permit, for 24 hours or 7 days. Owners and admins always can.</small></span></label>
      <label class="check"><input type="checkbox" name="alerts" ${state.alerts ? 'checked' : ''} ${owner ? '' : 'disabled'}><span>Tell me each time a teammate opens a file</span></label>
      ${owner ? html`<button class="btn btn-primary">Save</button>` : html`<p class="muted small">Only the workspace owner can change this.</p>`}
    </form>
    ${when(state.pending.length, html`<h3 class="h4">Waiting for your OK</h3>${state.pending.map((g) => html`<div class="line fg-req"><span class="line-main"><b>${g.who} wants to open ${g.permit}</b>
      <small>${g.note ? `"${g.note}" · ` : ''}asked ${timeAgo(g.requested_at).toLowerCase()}</small></span>
      <span class="btn-row"><button class="btn btn-primary btn-sm" data-act="file-decide" data-id="${g.id}" data-allow="1" data-hours="24">Allow 24 hours</button>
        <button class="btn btn-soft btn-sm" data-act="file-decide" data-id="${g.id}" data-allow="1" data-hours="168">7 days</button>
        <button class="btn btn-ghost btn-sm" data-act="file-decide" data-id="${g.id}" data-allow="">Decline</button></span></div>`)}`)}
    <h3 class="h4">Who opened what</h3>
    ${state.opens.length ? html`<div class="fg-opens">${state.opens.slice(0, 15).map((o) => html`<div class="line"><span class="line-main"><b>${o.file_name || 'A file'}</b>
        <small>${o.who} · ${reqById(o.requirement_id)?.name || 'a permit'} · ${fmtDateTime(o.opened_at)}</small></span></div>`)}</div>`
      : html`<p class="muted small">No one has opened a file yet${has('vault') ? '' : ' (files are listed here once the document vault is on)'}.</p>`}
    <p class="muted small">This record can't be edited or erased by anyone on your team.</p>
  </section>`;
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'file-guard-form') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  try { await db.setFileMode(S.org.id, fd.get('mode'), !!fd.get('alerts')); await loadFileAccess(true); toast('Saved.'); rerender(); } catch (err) { toastError(err); }
});
on('file-ask', (ds) => {
  const r = reqById(ds.id);
  openModal(`Ask to open: ${r?.name || 'files'}`, html`<p class="muted small">Your workspace owner and admins get a notification. You'll get one back when they answer.</p>
    <label class="field"><span>Why do you need them? <small>(optional)</small></span><input name="note" maxlength="300" placeholder="e.g. For the BPLO visit tomorrow"></label>`, {
    submitLabel: 'Send request',
    onSubmit: async (fd) => { await db.requestFileAccess(ds.id, fd.get('note')); await loadFileAccess(true); toast('Request sent.'); rerender(); },
  });
});
on('file-decide', async (ds) => {
  try { await db.decideFileAccess(ds.id, !!ds.allow, Number(ds.hours) || 24); await loadFileAccess(true); toast(ds.allow ? 'Allowed. They can open those files now.' : 'Declined.'); rerender(); } catch (e) { toastError(e); }
});
