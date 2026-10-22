// Builds the free public renewal guides: web/renew/ (index + one page per city), a calendar file for each,
// web/sitemap.xml and web/robots.txt. Plain HTML that search engines can read without running the app; the
// only script (js/renew-page.js) adds the countdown and the penalty estimate. The Mayor's Permit and barangay
// checklists come from the permit library (the same text the app shows), the city facts from renew-cities.mjs.
// Run: npm run build:renew   (also run by the deploy workflow and the browser tests; the output is not committed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, CHECKED, SEASON_2026 } from './renew-cities.mjs';
import { maxPenalty } from '../web/js/penalty.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE_URL || 'https://siggiebahamas.github.io/PermitPal/').replace(/\/?$/, '/');
const OUT = path.join(root, 'web/renew');

// ---------------------------------------------------------------- the season these pages are for
// January belongs to this year's season (late renewals, extensions); February onward to next year's.
const nowPH = new Date(Date.now() + 8 * 3600e3);
const YEAR = Number(process.env.SEASON || (nowPH.getUTCMonth() === 0 ? nowPH.getUTCFullYear() : nowPH.getUTCFullYear() + 1));
const DUE = `${YEAR}-01-20`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDate = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const weekday = (iso) => DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];

// ---------------------------------------------------------------- checklists, read from the permit library
function checklist(code) {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261017001800_library_checklists_services.sql'), 'utf8');
  const m = new RegExp(String.raw`checklist = \$j\$(\[(?:(?!\$j\$)[\s\S])*\])\$j\$::jsonb\s*where code = '${code}'`).exec(sql);
  if (!m) throw new Error(`No checklist for ${code} in the permit library`);
  return JSON.parse(m[1]);
}
const MAYORS = checklist('mayors_permit');
const BARANGAY = checklist('barangay_clearance');

// ---------------------------------------------------------------- helpers
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const ext = (url, label) => `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)}<span class="sr-only"> (opens in a new tab)</span></a>`;
const write = (rel, body) => { const f = path.join(root, 'web', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

function page({ up, rel, title, desc, body, here }) {
  const url = SITE + rel;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(SITE)}img/icon-512.png">
  <meta name="theme-color" content="#F8F6F2">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <link rel="icon" href="${up}img/logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="${up}css/app.css">
  <script type="module" src="${up}js/renew-page.js"></script>
</head>
<body class="rn-body">
<a class="skip-link" href="#main">Skip to the guide</a>
<div class="lp-wrap rn-wrap">
<header class="lp-top"><a class="brand" href="${up}"><img src="${up}img/logo.png" alt="" width="34" height="34"><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
  <div class="spacer"></div>
  <a class="btn btn-ghost btn-sm" href="${up}renew/"${here === 'index' ? ' aria-current="page"' : ''}>Guides</a><a class="btn btn-ghost btn-sm lp-nav" href="${up}#/login">Sign in</a><a class="btn btn-primary btn-sm" href="${up}#/signup">Start free</a></header>
<main id="main" class="rn" tabindex="-1">
${body}
</main>
<footer class="lp-foot"><span>© PermitPal</span><a href="${up}renew/">Renewal guides</a><a href="${up}#/pricing">Prices</a><a href="${up}privacy.html">Privacy</a><a href="${up}terms.html">Terms</a><a href="${up}#/contact">Contact</a></footer>
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------- page parts
const item = (c) => `<li><b>${esc(c.t)}</b>${c.d ? `<span>${esc(c.d)}</span>` : ''}</li>`;

const checklistSection = (city) => `<section class="rn-sec" aria-labelledby="prep">
  <h2 id="prep">What to prepare</h2>
  <p>${city ? `Most of the work is the same everywhere. ${esc(city.name)} may ask for a little more, so check its list too.` : 'Every city has its own forms, but they ask for much the same things.'} Start in December: the barangay clearance comes first, and offices get busy in January.</p>
  <div class="rn-steps">
    <div class="card rn-step"><span class="rn-num" aria-hidden="true">1</span><div><h3>Barangay Business Clearance</h3><p class="muted small">From the barangay hall where the business is. You need this year's before the Mayor's Permit.</p>
      <ul class="rn-list">${BARANGAY.map(item).join('')}</ul></div></div>
    <div class="card rn-step"><span class="rn-num" aria-hidden="true">2</span><div><h3>Mayor's Permit (business permit)</h3><p class="muted small">From ${city ? `${esc(city.name)}'s ${esc(city.office)}` : 'your city or municipal hall\'s business permits office (BPLO)'}, or online where the city offers it.</p>
      <ol class="rn-list">${MAYORS.map(item).join('')}</ol></div></div>
  </div>
</section>`;

function penaltySection() {
  const base = 5000, months = 1;
  const p = maxPenalty(base, months);
  return `<section class="rn-sec" aria-labelledby="late">
  <h2 id="late">If you renew late</h2>
  <p>The Local Government Code lets a city add <b>up to a 25% surcharge</b> on what's unpaid, plus <b>up to 2% interest a month</b> (on the unpaid amount and the surcharge) for as long as it stays unpaid, up to 36 months. Cities may charge less, never more. Operating without a current permit can also get a business closed.</p>
  <form class="card rn-est" data-penalty novalidate aria-labelledby="est-h">
    <h3 id="est-h">How much could being late cost?</h3>
    <div class="grid2">
      <label class="field"><span>Last year's permit taxes and fees (₱)</span><input name="base" type="number" inputmode="decimal" min="0" max="100000000" step="1" value="${base}"></label>
      <label class="field"><span>How late</span><select name="months">${[1, 2, 3, 6, 12].map((m) => `<option value="${m}"${m === months ? ' selected' : ''}>${m === 1 ? 'Up to 1 month' : `Up to ${m} months`}</option>`).join('')}</select></label>
    </div>
    <dl class="rn-est-out" aria-live="polite">
      <div><dt>Surcharge (up to 25%)</dt><dd data-v="surcharge">${peso(p.surcharge)}</dd></div>
      <div><dt>Interest (up to 2% a month, <span data-v="months">${months} month</span>)</dt><dd data-v="interest">${peso(p.interest)}</dd></div>
      <div class="rn-est-total"><dt>The most a city can add</dt><dd data-v="total">${peso(p.total)}</dd></div>
    </dl>
    <p class="muted small">On top of the regular taxes and fees. It's an upper limit using last year's amount; this year's assessment may differ.</p>
  </form>
</section>`;
}

const calendarCta = (file, label) => `<a class="btn btn-soft" href="${file}" download="${esc(label)}">${'Add the dates to my calendar'}</a>`;

const ctaSection = (city) => `<section class="card rn-cta" aria-labelledby="cta">
  <div><h2 id="cta">Get reminded before it's due, free</h2>
  <p>PermitPal keeps your Mayor's Permit, barangay clearance, fire safety certificate and the rest in one place${city ? ` for your ${esc(city.name)} business` : ''}, and emails you before each one expires. Free for one business.</p></div>
  <a class="btn btn-primary btn-lg" href="${city ? '../../' : '../'}#/signup">Start free</a>
</section>`;

const finePrint = (up) => `<p class="rn-fine muted small">Last checked ${longDate(CHECKED)}. Rules, fees and dates change every year and your city hall has the final say, so confirm with the office before you go. Something out of date? <a href="${up}#/contact">Tell us</a> and we'll fix it.</p>`;

// ---------------------------------------------------------------- calendar files (.ics)
function ics(city) {
  const where = city ? city.name : 'your city';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PermitPal//Renewal guide//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:Business permit renewal ${YEAR}${city ? ' · ' + city.name : ''}`,
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = (iso, summary, desc) => {
    const d = iso.replace(/-/g, '');
    const next = new Date(Date.parse(iso + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${d}-${city ? city.slug : 'all'}-renewal@permitpal`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${icsText(summary)}`, `DESCRIPTION:${icsText(desc)}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  };
  const guide = SITE + (city ? `renew/${city.slug}/` : 'renew/');
  const anniv = city?.anniversary ? ` ${city.name} counts a year from your permit's issue date, so check the date printed on it.` : '';
  ev(`${YEAR - 1}-12-01`, `Get your business permit papers ready (${where})`,
    `Gather last year's permit and receipt, gross sales (BIR returns), proof of address and your SSS, PhilHealth and Pag-IBIG proof of payment.${anniv} Checklist: ${guide}`);
  ev(`${YEAR}-01-05`, `Get this year's barangay business clearance (${where})`,
    `You need it before the Mayor's Permit. Bring last year's clearance and proof of address. Checklist: ${guide}`);
  ev(`${YEAR}-01-13`, `One week left: business permit renewal (${where})`,
    `Most cities want the Mayor's Permit renewed by January 20. Late renewals can pay up to a 25% surcharge plus 2% a month. ${guide}`);
  ev(DUE, city?.anniversary ? `Business tax usually due; check your permit's own renewal date (${where})` : `Business permit renewal due (${where})`,
    `January 20 is the usual deadline. Some cities extend it, often only at the last minute, so don't count on it.${anniv} ${guide}`);
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
// Lines longer than 75 bytes continue on the next line after a space (RFC 5545), without splitting a character.
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// ---------------------------------------------------------------- one page per city
function cityPage(city) {
  const others = CITIES.filter((c) => c !== city);
  const facts = city.facts.length
    ? `<ul class="rn-facts">${city.facts.map((f) => `<li><p>${esc(f.t)}</p><small class="muted">Source: ${ext(f.src[1], f.src[0])}</small></li>`).join('')}</ul>`
    : `<p>We haven't found anything specific to ${esc(city.name)} yet beyond its official pages. The checklist above is what most offices ask for; call or visit the ${esc(city.office)} to confirm before you go.</p>`;
  const official = city.official?.length
    ? `<ul class="rn-links">${city.official.map((o) => `<li>${ext(o.url, o.label)}</li>`).join('')}</ul>`
    : `<p class="small">We couldn't confirm an online renewal link on the city's own website. Ask the ${esc(city.office)}, or watch the city's official announcements in December.</p>`;
  const body = `<nav class="rn-crumbs" aria-label="Breadcrumb"><a href="../">Renewal guides</a> <span aria-hidden="true">›</span> <span aria-current="page">${esc(city.name)}</span></nav>
<p class="rn-kicker">${esc(city.area)} · Business permit renewal ${YEAR}</p>
<h1>Renewing your business permit in ${esc(city.name)}</h1>
<p class="rn-lead">What to prepare, the dates to watch, what being late can cost, and ${esc(city.name)}'s official links, in one page.</p>

<section class="card rn-due" aria-label="Key dates and where to renew">
  <div class="rn-due-main">
    ${city.anniversary
      ? `<span class="rn-k">When it's due</span><b class="rn-date">One year from your permit's issue date</b><span class="rn-sub">Check the date printed on your current permit. Many offices still get busiest around January 20.</span>`
      : `<span class="rn-k">Usually due</span><b class="rn-date">${weekday(DUE)}, ${longDate(DUE)}</b><span class="rn-count" data-countdown="${DUE}"></span>`}
    ${calendarCta('calendar.ics', `permit-renewal-${YEAR}-${city.slug}.ics`)}
  </div>
  <dl class="rn-due-facts">
    <div><dt>Where</dt><dd>${esc(city.office)}${city.contact ? `<br><span class="small">${esc(city.contact)}</span>` : ''}</dd></div>
    <div><dt>Official links</dt><dd>${official}</dd></div>
  </dl>
</section>

${checklistSection(city)}

<section class="rn-sec" aria-labelledby="know">
  <h2 id="know">What we know about ${esc(city.name)}</h2>
  ${facts}
  ${city.anniversary ? '' : `<p class="muted small">Extensions are announced by the city, often only around January 20 itself. Plan for January 20.</p>`}
</section>

${penaltySection()}

${ctaSection(city)}

<section class="rn-sec" aria-labelledby="more">
  <h2 id="more">Other cities</h2>
  <ul class="rn-cities rn-cities-sm">${others.map((c) => `<li><a href="../${c.slug}/">${esc(c.name)}</a></li>`).join('')}</ul>
</section>
${finePrint('../../')}`;
  write(`renew/${city.slug}/index.html`, page({
    up: '../../', rel: `renew/${city.slug}/`,
    title: `Business permit renewal ${YEAR} in ${city.name}: checklist and deadline · PermitPal`,
    desc: `How to renew your Mayor's Permit in ${city.name} for ${YEAR}: what to prepare, the deadline, late penalties, and the city's official links.`,
    body,
  }));
  write(`renew/${city.slug}/calendar.ics`, ics(city));
}

// ---------------------------------------------------------------- the index
function indexPage() {
  const areas = [...new Set(CITIES.map((c) => c.area))];
  const bySlug = Object.fromEntries(CITIES.map((c) => [c.name, c]));
  const body = `<p class="rn-kicker">Business permit renewal ${YEAR}</p>
<h1>Business permit renewal guides</h1>
<p class="rn-lead">Free, plain checklists for renewing your Mayor's Permit in the Philippines, city by city: what to prepare, the dates, what being late can cost, and links to each city's own website where we could confirm them.</p>

<section class="card rn-due" aria-label="Key dates">
  <div class="rn-due-main">
    <span class="rn-k">Most cities want it by</span><b class="rn-date">${weekday(DUE)}, ${longDate(DUE)}</b><span class="rn-count" data-countdown="${DUE}"></span>
    ${calendarCta('calendar.ics', `permit-renewal-${YEAR}.ics`)}
  </div>
  <dl class="rn-due-facts">
    <div><dt>Why January 20</dt><dd>Local business taxes are due in the first 20 days of January, unless the city's own ordinance says otherwise.</dd></div>
    <div><dt>First stop</dt><dd>This year's barangay business clearance. Cities ask for it before the Mayor's Permit.</dd></div>
  </dl>
</section>

<section class="rn-sec" aria-labelledby="cities">
  <h2 id="cities">Pick your city</h2>
  ${areas.map((a) => `<h3 class="rn-area">${esc(a)}</h3><ul class="rn-cities">${CITIES.filter((c) => c.area === a).map((c) => `<li><a class="card rn-city" href="${c.slug}/"><b>${esc(c.name)}</b><span class="muted small">${c.official?.length ? 'Official links inside' : 'Checklist and past dates'}</span></a></li>`).join('')}</ul>`).join('')}
  <p class="muted small">Don't see your city? The checklist below is what most offices ask for.</p>
</section>

<section class="rn-sec" aria-labelledby="season">
  <h2 id="season">When renewals were really due in ${2026}</h2>
  <p>Some cities extended the deadline, but several did it only around January 20 itself, and others didn't extend at all. Don't plan on an extension.</p>
  <div class="rn-table-wrap"><table class="rn-table">
    <thead><tr><th scope="col">City</th><th scope="col">Last day without penalty</th></tr></thead>
    <tbody>${SEASON_2026.map((r) => `<tr><th scope="row"><a href="${bySlug[r.city].slug}/">${esc(r.city)}</a></th><td><b>${esc(r.due)}</b><span>${esc(r.note)}</span></td></tr>`).join('')}</tbody>
  </table></div>
  <p class="muted small">Sources are listed on each city's page.</p>
</section>

${checklistSection(null)}

${penaltySection()}

${ctaSection(null)}
${finePrint('../')}`;
  write('renew/index.html', page({
    up: '../', rel: 'renew/', here: 'index',
    title: `Business permit renewal ${YEAR}: checklists by city · PermitPal`,
    desc: `Free checklists for renewing your Mayor's Permit in ${YEAR}, city by city: what to prepare, the January 20 deadline, late penalties, and official links.`,
    body,
  }));
  write('renew/calendar.ics', ics(null));
}

// ---------------------------------------------------------------- sitemap and robots
function sitemap() {
  const urls = [['', null], ['renew/', CHECKED], ...CITIES.map((c) => [`renew/${c.slug}/`, CHECKED]), ['terms.html', null], ['privacy.html', null]];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${esc(SITE + u)}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`);
  write('robots.txt', `User-agent: *\nDisallow: ${new URL(SITE).pathname}demo/\nSitemap: ${SITE}sitemap.xml\n`);
}

fs.rmSync(OUT, { recursive: true, force: true });
CITIES.forEach(cityPage);
indexPage();
sitemap();
console.log(`Renewal guides for ${YEAR}: ${CITIES.length} cities + index, sitemap.xml and robots.txt written.`);
