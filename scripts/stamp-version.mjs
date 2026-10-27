// After a deploy build: put the version on every link to our own CSS and JS (app.css?v=abc1234, './util.js?v=abc1234'),
// so a browser that kept yesterday's files fetches the new ones as soon as the page itself updates.
// The import map's CSP hash in index.html is recomputed to match. Run: node scripts/stamp-version.mjs <version>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const v = process.argv[2];
if (!v) { console.error('usage: node scripts/stamp-version.mjs <version>'); process.exit(1); }
const q = `?v=${encodeURIComponent(v)}`;
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p, out); } else out.push(p);
  }
  return out;
};
const files = walk('web');
// JS modules: relative imports, static and dynamic.
const rel = /((?:\bfrom|\bimport)\s*\(?\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g;
let n = 0;
for (const f of files.filter((f) => f.endsWith('.js') && f.includes(`${path.sep}js${path.sep}`))) {
  const s = fs.readFileSync(f, 'utf8');
  const t = s.replace(rel, (m, a, b, c) => { n++; return a + b + q + c; });
  if (t !== s) fs.writeFileSync(f, t);
}
// HTML pages (not the self-contained demo): our own css/js links, and the import map with its CSP hash.
for (const f of files.filter((f) => f.endsWith('.html') && !f.endsWith('demo.html'))) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;
  s = s.replace(/((?:href|src)=")((?:\.\.\/|\.\/)*(?:css|js)\/[^"?]+\.(?:css|js))(")/g, (m, a, b, c) => { n++; return a + b + q + c; });
  const im = /<script type="importmap">([\s\S]*?)<\/script>/.exec(s);
  if (im) {
    const map = im[1];
    const next = map.replace(/("\.\/js\/[^"?]+\.js)(")/g, `$1${q}$2`);
    const hash = (x) => crypto.createHash('sha256').update(x).digest('base64');
    s = s.replace(im[0], `<script type="importmap">${next}</script>`).replace(`'sha256-${hash(map)}'`, `'sha256-${hash(next)}'`);
  }
  if (s !== before) fs.writeFileSync(f, s);
}
console.log(`Stamped ${n} links with ${q}.`);
