// "Fill from a photo": take or choose a photo of the permit, and we fill in its dates, number and plate.
// Guard rails, because a misread date is worse than no date: only empty boxes are filled, every filled
// box is highlighted, other dates found are one tap away, a wrong-looking document is called out, and
// the form can't be saved until the person ticks that they checked the details against the paper.
import { html, fmtDate, todayPH, plural } from '../util.js';
import { typeOf } from '../core.js';
import { ICON } from '../components.js';
import { readDocument } from '../ocrparse.js';

export const scanBox = () => html`<div class="scan-box">
  <button type="button" class="btn btn-soft btn-sm" data-scan-start>${ICON.camera} Fill from a photo</button>
  <input type="file" accept="image/*" capture="environment" data-scan-file hidden>
  <small class="muted">Optional. We read the dates and numbers on the photo, on this phone, and you check them before saving.</small>
  <div class="scan-status" aria-live="polite"></div></div>`;

// fields: { inputName: 'expires' | 'issued' | 'reference' | 'plate' }; attach: name of the file input to put the photo in.
export function wireScan(form, { fields, attach = 'file', expect = null }) {
  const box = form.querySelector('.scan-box');
  if (!box) return;
  const btn = box.querySelector('[data-scan-start]');
  const input = box.querySelector('[data-scan-file]');
  const status = box.querySelector('.scan-status');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    btn.disabled = true;
    const say = (pct, msg) => { status.innerHTML = String(html`<div class="scan-progress"><span style="width:${Math.round(pct * 100)}%"></span></div><small>${msg}</small>`); };
    try {
      const { readPhoto } = await import('../ocr.js');
      const text = await readPhoto(file, say);
      show(readDocument(text, todayPH()), file);
    } catch (e) {
      status.innerHTML = String(html`<p class="form-error" role="alert">${e.message || "We couldn't read that photo."}</p>`);
    } finally {
      btn.disabled = false;
      btn.lastChild.textContent = ' Try another photo';
      input.value = '';
    }
  });

  function show(found, file) {
    if (found.chars < 20) {
      status.innerHTML = String(html`<p class="banner warn">We couldn't make out any text. Try again with the document flat, in good light, filling most of the photo.</p>`);
      return;
    }
    const lines = [];
    const filled = [];
    for (const [name, kind] of Object.entries(fields)) {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el || el.closest('[hidden]')) continue;
      const list = kind === 'expires' ? found.expires.map((d) => d.value) : kind === 'issued' ? found.issued.map((d) => d.value)
        : kind === 'reference' ? found.references.map((r) => r.value) : found.plates.map((p) => p.value);
      const label = el.closest('label')?.querySelector('span')?.childNodes[0]?.textContent.trim() || name;
      if (!list.length) { lines.push(html`<li><b>${label}:</b> <span class="muted">not found. Type it in.</span></li>`); continue; }
      const fmt = (v) => (el.type === 'date' ? fmtDate(v) : v);
      if (!el.value || el.dataset.prefill) { // a default we filled in (like today's date) gives way to the photo
        delete el.dataset.prefill;
        el.value = list[0];
        el.classList.add('from-scan');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        filled.push(label);
      }
      const others = list.filter((v) => v !== el.value);
      lines.push(html`<li><b>${label}:</b> <span class="scan-val">${el.value === list[0] ? html`filled in <b>${fmt(list[0])}</b>` : html`you already typed <b>${fmt(el.value)}</b>`}</span>
        ${others.length ? html` · also found: ${others.map((v) => html`<button type="button" class="chip-btn small" data-scan-use="${name}" data-v="${v}">${fmt(v)}</button>`)}` : ''}</li>`);
    }
    const expectName = expect ? typeOf(expect)?.name : null;
    const kindName = found.kind ? typeOf(found.kind)?.name || found.kind.replace(/_/g, ' ') : null;
    const mismatch = expect && found.kind && found.kind !== expect;
    // the photo becomes the document, if the form has a place for one and it's empty
    const fileInput = attach ? form.querySelector(`input[type=file][name="${attach}"]`) : null;
    let attached = false;
    if (fileInput && !fileInput.files.length) {
      try { const dt = new DataTransfer(); dt.items.add(file); fileInput.files = dt.files; attached = true; } catch { /* older browsers: they can pick it themselves */ }
    }
    status.innerHTML = String(html`<div class="scan-result">
      ${mismatch ? html`<p class="banner warn"><b>Is this the right photo?</b> It looks like a ${kindName}, not a ${expectName}.</p>` : ''}
      <p><b>${filled.length ? `We filled in ${plural(filled.length, 'box', 'boxes')} from the photo` : 'Here is what we found'}.</b> Check each one against the document: photos can be misread.</p>
      <ul class="scan-list">${lines}</ul>
      ${attached ? html`<p class="small">${ICON.check} The photo will be saved as the document. <button type="button" class="linklike" data-scan-detach>Don't attach it</button></p>` : ''}
      ${filled.length ? html`<label class="check scan-ok"><input type="checkbox" name="scan_ok" required><span>I checked the filled-in details against the document</span></label>` : ''}
    </div>`);
    status.querySelectorAll('[data-scan-use]').forEach((b) => b.addEventListener('click', () => {
      const el = form.querySelector(`[name="${b.dataset.scanUse}"]`);
      el.value = b.dataset.v; el.classList.add('from-scan'); el.dispatchEvent(new Event('input', { bubbles: true }));
      b.closest('li').querySelector('.scan-val').innerHTML = String(html`using <b>${el.type === 'date' ? fmtDate(b.dataset.v) : b.dataset.v}</b>`);
    }));
    status.querySelector('[data-scan-detach]')?.addEventListener('click', (e) => { fileInput.value = ''; e.target.closest('p').remove(); });
  }
  // Typing over a filled box removes its highlight.
  form.addEventListener('input', (e) => { if (e.isTrusted) { e.target.classList?.remove('from-scan'); if (e.target.dataset) delete e.target.dataset.prefill; } });
}
