// Picking dates, reference numbers, plate numbers and the kind of permit out of text read from a photo.
// Photos are messy (O for 0, l for 1, broken lines), so this is deliberately careful: it only offers what
// looks right, ranks it, and the person always checks it against the paper before saving.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthOf = (s) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3))) + 1;

const iso = (y, m, d) => {
  if (y < 2000 || y > 2060 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
// Inside things that should be numbers, the usual misreads: O→0, l/I/|→1, S→5, B→8.
const digits = (s) => s.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');

const EXPIRE_WORDS = /valid\s*(until|thru|through|up\s*to)|expir|until|validity|good\s*until|due\s*date|to\s*:?\s*$/i;
const ISSUE_WORDS = /issued|date\s*of\s*issu|issue\s*date|date\s*issued|granted|released|from\s*:?\s*$/i;

// Every date in the text, with where it was and what it seems to be for.
export function findDates(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, li) => {
    const add = (value, index, raw) => {
      if (!value) return;
      const before = line.slice(Math.max(0, index - 40), index) + ' ' + (lines[li - 1] || '').slice(-40);
      const role = EXPIRE_WORDS.test(line.slice(Math.max(0, index - 40), index)) ? 'expires'
        : ISSUE_WORDS.test(line.slice(Math.max(0, index - 40), index)) ? 'issued'
        : EXPIRE_WORDS.test(before) ? 'expires' : ISSUE_WORDS.test(before) ? 'issued' : null;
      out.push({ value, raw: raw.trim(), role, line: li });
    };
    let m;
    const words = new RegExp(`\\b${MON_RE}\\.?\\s+([0-9OolI]{1,2}),?\\s+([0-9OolISB]{4})\\b`, 'gi');
    while ((m = words.exec(line))) add(iso(+digits(m[3]), monthOf(m[1]), +digits(m[2])), m.index, m[0]);
    const dayFirstWords = new RegExp(`\\b([0-9OolI]{1,2})\\s+${MON_RE}\\.?,?\\s+([0-9OolISB]{4})\\b`, 'gi');
    while ((m = dayFirstWords.exec(line))) add(iso(+digits(m[3]), monthOf(m[2]), +digits(m[1])), m.index, m[0]);
    const isoRe = /\b([0-9OolISB]{4})[-/.]([0-9OolI]{1,2})[-/.]([0-9OolI]{1,2})\b/g;
    while ((m = isoRe.exec(line))) add(iso(+digits(m[1]), +digits(m[2]), +digits(m[3])), m.index, m[0]);
    const num = /\b([0-9OolI]{1,2})[-/.]([0-9OolI]{1,2})[-/.]([0-9OolISB]{4}|\d{2})\b/g;
    while ((m = num.exec(line))) {
      let [a, b, y] = [+digits(m[1]), +digits(m[2]), +digits(m[3])];
      if (y < 100) y += 2000;
      // month first, as Philippine documents usually print; day first only when the first can't be a month
      add(a > 12 ? iso(y, b, a) : iso(y, a, b), m.index, m[0]);
    }
  });
  // one entry per date, keeping the most informative role
  const seen = new Map();
  for (const d of out) { const p = seen.get(d.value); if (!p || (!p.role && d.role)) seen.set(d.value, d); }
  return [...seen.values()];
}

// The best guesses for "expires" and "issued", most likely first.
export function datesFor(text, today) {
  const all = findDates(text);
  const byDate = (a, b) => (a.value < b.value ? -1 : 1);
  const expires = [...all.filter((d) => d.role === 'expires'), ...all.filter((d) => !d.role && d.value >= today).sort((a, b) => -byDate(a, b))]
    .filter((d, i, arr) => arr.findIndex((x) => x.value === d.value) === i);
  const issued = [...all.filter((d) => d.role === 'issued'), ...all.filter((d) => !d.role && d.value <= today).sort((a, b) => -byDate(a, b))]
    .filter((d, i, arr) => arr.findIndex((x) => x.value === d.value) === i && !(d.role === null && expires[0]?.value === d.value));
  // an "expires" before the "issued" is a misread: drop it
  const firstIssued = issued[0]?.value;
  return { expires: expires.filter((d) => !firstIssued || d.value > firstIssued).slice(0, 4), issued: issued.slice(0, 4), all };
}

// Reference numbers next to the labels permits use.
const REF_LABELS = /(permit|reference|ref|control|certificate|cert|fsic|policy|coc|license|license|or|receipt|clearance|registration|account|series|serial|business\s*id|bin|plate)?\s*(no|number|num|#)\.?\s*[:.]?\s*/gi;
export function findReferences(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    let m;
    REF_LABELS.lastIndex = 0;
    while ((m = REF_LABELS.exec(line))) {
      if (!m[2] || m[0].trim().length < 2) continue;
      const label = (m[1] || '').toLowerCase();
      if (label === 'plate') continue; // plates are found separately
      const rest = line.slice(m.index + m[0].length);
      const tok = /^([A-Z0-9][A-Z0-9\-/]{2,29})/i.exec(rest.trim());
      if (!tok) continue;
      const v = tok[1].replace(/[-/]+$/, '');
      if (!/\d/.test(v) || /^(19|20)\d\d$/.test(v)) continue; // needs a digit; a bare year isn't a number
      if (!out.some((x) => x.value === v)) out.push({ value: v, label: label || 'no.' });
    }
  }
  return out.slice(0, 5);
}

// Philippine plates: ABC 1234 / ABC 123 (cars), 123 ABC / AB 12345 (motorcycles), old AB 1234.
export function findPlates(text) {
  const t = String(text || '').toUpperCase();
  const out = [];
  const add = (v, near) => { const p = v.replace(/\s+/g, ' ').trim(); if (!out.some((x) => x.value === p)) out.push({ value: p, near }); };
  for (const line of t.split(/\r?\n/)) {
    const near = /PLATE/.test(line);
    let m;
    const car = /\b([A-Z]{3})[\s-]?([0-9OIL]{3,4})\b/g;
    while ((m = car.exec(line))) if (!/^(NO|PHP|TIN|VIN|ORN|BIR|LTO|DTI|SEC|NBI|PNP|BFP|DOH|MFR|YEAR)$/.test(m[1])) add(`${m[1]} ${digits(m[2].replace(/L/g, '1'))}`, near);
    // 123 ABC is too easy to confuse with ordinary words, so only next to the word "plate"
    const moto = /\b(\d{3})[\s-]?([A-Z]{3})\b/g;
    while (near && (m = moto.exec(line))) if (!/^(AND|THE|FOR|NOT|ARE|YOU|PHP|PER|NOS|MAY|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.test(m[2])) add(`${m[1]} ${m[2]}`, near);
  }
  return out.sort((a, b) => (b.near ? 1 : 0) - (a.near ? 1 : 0)).slice(0, 3);
}

// What kind of document it looks like (to warn if the wrong photo was picked).
const KIND_WORDS = [
  ['mayors_permit', /mayor'?s\s*permit|business\s*permit|permit\s*to\s*operate|bplo/i],
  ['barangay_clearance', /barangay\s*(business\s*)?clearance/i],
  ['fsic', /fire\s*safety\s*inspection|\bfsic\b|bureau\s*of\s*fire/i],
  ['sanitary_permit', /sanitary\s*permit/i],
  ['bir_cor', /certificate\s*of\s*registration[\s\S]{0,80}bureau\s*of\s*internal|\b2303\b|bureau\s*of\s*internal\s*revenue/i],
  ['dti_business_name', /business\s*name\s*registration|department\s*of\s*trade/i],
  ['ctpl', /compulsory\s*third\s*party|\bctpl\b|certificate\s*of\s*cover/i],
  ['drivers_license', /driver'?s\s*licen[sc]e|non-?professional|professional\s*driver/i],
  ['emission_test', /emission/i],
  ['lto_registration', /land\s*transportation|motor\s*vehicle\s*registration|\bor\s*\/\s*cr\b/i],
  ['nbi_clearance', /\bnbi\b|national\s*bureau\s*of\s*investigation/i],
  ['police_clearance', /police\s*clearance/i],
  ['health_certificate', /health\s*(certificate|card)/i],
];
export function guessKind(text) {
  const hit = KIND_WORDS.find(([, re]) => re.test(text || ''));
  return hit ? hit[0] : null;
}

// Everything at once.
export function readDocument(text, today) {
  const d = datesFor(text, today);
  return { expires: d.expires, issued: d.issued, references: findReferences(text), plates: findPlates(text), kind: guessKind(text), chars: String(text || '').replace(/\s/g, '').length };
}
