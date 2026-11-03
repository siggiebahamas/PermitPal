// City deadlines, the arithmetic: one city however it's spelled ("QC", "Q.C.", "Quezon City" are one), the way the
// database matches them (private.city_key), and whether a city's extension or rule gives a business permit another date.
const ACCENT = { ñ: 'n', á: 'a', à: 'a', â: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i', î: 'i', ï: 'i', ó: 'o', ò: 'o', ô: 'o', ö: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u' };
export function cityKey(s) {
  const k = String(s || '').split(',')[0].toLowerCase().replace(/[ñáàâäéèêëíìîïóòôöúùûü]/g, (c) => ACCENT[c])
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(the )?(city|municipality) of /, '').replace(/ city$/, '').trim();
  return k === 'qc' || k === 'q c' ? 'quezon' : k;
}

// The live extension for this permit's city and year, while the permit still shows an earlier date.
export function extensionFor(r, city, deadlines = []) {
  if (r.type_code !== 'mayors_permit' || !r.expires || !r.expires_on || !city) return null;
  const k = cityKey(city);
  const y = Number(r.expires_on.slice(0, 4));
  return deadlines.find((d) => d.city_key === k && d.permit_year === y && r.expires_on < d.due_on) || null;
}

const addYear = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
// Quezon City's rule: renew a year from the issue date. Offered only when the permit shows the usual January 20
// (the date most people take from the general rule) and the issue date says otherwise.
export function anniversaryDue(r, rule) {
  if (!rule || rule.rule !== 'anniversary' || r.type_code !== 'mayors_permit' || !r.expires || !r.issued_on || !r.expires_on) return null;
  if (r.expires_on.slice(5) !== '01-20') return null;
  const due = addYear(r.issued_on);
  return due !== r.expires_on ? due : null;
}
