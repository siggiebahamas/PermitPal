// Reading Excel (.xlsx) files in the browser, without any outside library: an .xlsx file is a zip of XML
// files. We unzip only what we need (the sheet list, the shared text, the date formats and one sheet)
// and turn the sheet into rows of plain text, the same shape the CSV reader gives. Dates become
// 2027-03-10 so nobody has to guess which number is the month.
const MAX_ROWS = 5000;
const MAX_COLS = 60;
const MAX_UNZIPPED = 30 * 1024 * 1024; // a sheet bigger than this is not a permit list

export const canReadExcel = () => typeof DecompressionStream === 'function' && typeof DOMParser === 'function';

// ---------------------------------------------------------------- zip
function entries(buf) {
  const v = new DataView(buf);
  // the "end of central directory" record is in the last 64 KB
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not an Excel file we can read. Save it as .xlsx or CSV and try again.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= buf.byteLength; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    out.set(name.replace(/^\//, ''), { method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
async function readEntry(buf, e) {
  if (!e) return null;
  if (e.usize > MAX_UNZIPPED) throw new Error('This spreadsheet is too big. Split it into smaller files (a few thousand rows each).');
  const v = new DataView(buf);
  if (v.getUint32(e.local, true) !== 0x04034b50) throw new Error('This Excel file looks damaged. Open it in Excel and save it again.');
  const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
  const data = new Uint8Array(buf, start, e.csize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error('This Excel file uses a format we can\'t read. Save it as .xlsx or CSV and try again.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}
const xml = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This Excel file looks damaged. Open it in Excel and save it again.');
  return doc;
};
const all = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];

// ---------------------------------------------------------------- dates
const BUILTIN_DATES = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function isDateFormat(code) {
  const s = String(code || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dy]/i.test(s) || (/m/i.test(s) && !/[hs]/i.test(s) && !/^[#0.,%\s]*$/.test(s));
}
function serialToIso(n, date1904) {
  const days = Math.floor(Number(n));
  if (!Number.isFinite(days) || days <= 0 || days > 2958465) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

const colIndex = (ref) => {
  const letters = /^[A-Z]+/i.exec(ref || '')?.[0]?.toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// ---------------------------------------------------------------- the workbook
// Returns { sheets: [names], read(index) -> Promise<rows> }.
export async function openWorkbook(file) {
  if (!canReadExcel()) throw new Error('This browser can\'t read Excel files. Save the sheet as CSV (File → Save As → CSV) and choose that instead.');
  const buf = await file.arrayBuffer();
  const files = entries(buf);
  const wbText = await readEntry(buf, files.get('xl/workbook.xml'));
  if (!wbText) throw new Error('This is not an Excel workbook. Save it as .xlsx or CSV and try again.');
  const wb = xml(wbText);
  const date1904 = all(wb, 'workbookPr').some((n) => ['1', 'true'].includes(n.getAttribute('date1904')));
  const rels = new Map();
  const relText = await readEntry(buf, files.get('xl/_rels/workbook.xml.rels'));
  if (relText) for (const r of all(xml(relText), 'Relationship')) rels.set(r.getAttribute('Id'), r.getAttribute('Target'));
  const sheets = all(wb, 'sheet').map((s) => {
    const rid = s.getAttribute('r:id') || [...s.attributes].find((a) => a.localName === 'id')?.value;
    let target = rels.get(rid) || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    return { name: s.getAttribute('name') || 'Sheet', path: target, hidden: s.getAttribute('state') === 'hidden' || s.getAttribute('state') === 'veryHidden' };
  }).filter((s) => !s.hidden && files.has(s.path));
  if (!sheets.length) throw new Error('This workbook has no sheets we can read.');

  let shared = null, styles = null;
  const loadShared = async () => {
    if (shared) return shared;
    const t = await readEntry(buf, files.get('xl/sharedStrings.xml'));
    shared = t ? all(xml(t), 'si').map((si) => all(si, 't').filter((n) => n.parentNode?.localName !== 'rPh').map((n) => n.textContent).join('')) : [];
    return shared;
  };
  const loadStyles = async () => {
    if (styles) return styles;
    const t = await readEntry(buf, files.get('xl/styles.xml'));
    styles = [];
    if (t) {
      const doc = xml(t);
      const custom = new Map(all(doc, 'numFmt').map((n) => [Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode')]));
      const xfs = all(doc, 'cellXfs')[0];
      if (xfs) styles = [...xfs.children].filter((x) => x.localName === 'xf').map((x) => {
        const id = Number(x.getAttribute('numFmtId') || 0);
        return BUILTIN_DATES.has(id) || (custom.has(id) && isDateFormat(custom.get(id)));
      });
    }
    return styles;
  };

  return {
    sheets: sheets.map((s) => s.name),
    async read(index = 0) {
      const sheet = sheets[index] || sheets[0];
      const [ss, isDate] = [await loadShared(), await loadStyles()];
      const doc = xml(await readEntry(buf, files.get(sheet.path)));
      const rows = [];
      for (const row of all(doc, 'row')) {
        if (rows.length >= MAX_ROWS) break;
        const out = [];
        let next = 0;
        for (const c of [...row.children].filter((x) => x.localName === 'c')) {
          let i = colIndex(c.getAttribute('r'));
          if (i < 0) i = next;
          next = i + 1;
          if (i >= MAX_COLS) continue;
          const t = c.getAttribute('t');
          const vNode = [...c.children].find((x) => x.localName === 'v');
          const raw = vNode ? vNode.textContent : '';
          let val = '';
          if (t === 's') val = ss[Number(raw)] ?? '';
          else if (t === 'inlineStr') val = all(c, 't').map((n) => n.textContent).join('');
          else if (t === 'str') val = raw;
          else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'e') val = '';
          else if (t === 'd') val = raw.slice(0, 10);
          else if (raw !== '') {
            const s = Number(c.getAttribute('s') || 0);
            val = isDate[s] ? serialToIso(raw, date1904) || raw : String(Number(raw)) === raw ? raw : String(Number(raw));
          }
          while (out.length < i) out.push('');
          out[i] = val;
        }
        rows.push(out);
      }
      return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
    },
  };
}
