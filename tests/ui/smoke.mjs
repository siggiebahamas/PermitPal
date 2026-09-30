// Browser smoke test: loads the real app with an in-memory data layer and walks through
// every page and the main flows on a phone-sized and a desktop-sized screen.
// Run: node tests/ui/smoke.mjs   (needs playwright; uses the preinstalled Chromium)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  let file = p.startsWith('/__mock/') ? path.join(root, 'tests/ui', p.slice(8)) : path.join(root, 'web', p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (p === '/index.html') {
    // Point the data layer at the mock; drop the CSP (it pins the import map's hash).
    body = String(body).replace('"./js/data.js"', '"/__mock/mock-data.js"').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
      .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, ''); // web fonts are cosmetic; tests run offline
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const results = [];
const check = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(250); };

  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  const h1 = await page.textContent('main h1');
  check(`${label}: dashboard loads`, h1.includes('Sadie'), h1);
  check(`${label}: overdue permit counted`, (await page.textContent('.stat.overdue .stat-n')).trim() === '1');
  check(`${label}: business name is escaped, not injected`, (await page.locator('text=Corner <Bakery> & Co').count()) > 0 && (await page.locator('main Bakery').count()) === 0);
  check(`${label}: BIR COR (never recorded) is NOT shown as compliant`,
    (await page.locator('.row.needinfo', { hasText: 'BIR Certificate' }).count()) > 0);

  for (const h of ['#/businesses', '#/businesses/b1', '#/vehicles', '#/vehicles/v1', '#/compliance', '#/documents', '#/help', '#/notifications', '#/history', '#/trash', '#/team', '#/settings', '#/settings/billing', '#/settings/workspace', '#/admin']) {
    await go(h);
    await page.waitForSelector('main h1', { timeout: 5000 }).catch(() => {});
    const t = await page.textContent('main').catch(() => '');
    check(`${label}: ${h} renders`, !!t && !t.includes('Something went wrong'), t.slice(0, 60).replace(/\s+/g, ' '));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label}: ${h} has no sideways scroll`, overflow <= 1, `overflow ${overflow}px`);
  }

  if (label === 'phone') {
    // Renew the overdue Mayor's Permit without a new file -> must not become compliant (bug #2).
    await go('#/businesses/b1');
    await page.click('.row.overdue button:has-text("Renew")');
    await page.waitForSelector('.modal');
    check('renew modal suggests Jan 20', (await page.textContent('.suggest')).includes('Jan 20'));
    await page.click('.suggest button');
    await page.fill('[name=reference_no]', 'MP-2027');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.modal', { state: 'detached' });
    await page.waitForTimeout(300);
    check('after renewal without file: needs info, not compliant',
      (await page.locator('.row.needinfo', { hasText: "Mayor's" }).count()) === 1, await page.textContent('#tab-body'));

    // Upload the new document -> compliant.
    await page.click('.row.needinfo:has-text("Mayor\'s") button');
    await page.waitForSelector('.modal input[type=file]');
    await page.setInputFiles('.modal input[type=file]', { name: 'mayors-2027.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.modal', { state: 'detached' });
    await page.waitForTimeout(300);
    check('after upload: compliant', (await page.locator('.row.ok', { hasText: "Mayor's" }).count()) === 1);

    // Add a business: starter checklist appears, all needing info.
    await go('#/businesses');
    await page.click('button:has-text("Add business")');
    await page.fill('.modal [name=name]', 'Cebu Store');
    await page.fill('.modal [name=city]', 'Cebu City');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('main h1:has-text("Cebu Store")');
    check('new business has a starter checklist, none compliant',
      (await page.locator('#tab-body .row').count()) === 3 && (await page.locator('#tab-body .row.ok').count()) === 0);

    // Get help flow -> request listed and requirement goes in progress (bug #3).
    await go('#/help');
    await page.click('.pick-item:has-text("CTPL")');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Send request")');
    await page.waitForTimeout(400);
    check('help request listed', (await page.locator('.request', { hasText: 'CTPL' }).count()) === 1);
    await go('#/vehicles/v1');
    check('requirement with open help request shows in progress', (await page.locator('.row.progress', { hasText: 'CTPL' }).count()) === 1);

    // Delete and restore a vehicle.
    await go('#/vehicles/v1');
    await page.click('button.tab:has-text("Details")');
    await page.click('button:has-text("Delete this vehicle")');
    await page.click('.modal button[type=submit]');
    await page.waitForTimeout(400);
    await go('#/trash');
    check('deleted vehicle is in Trash', (await page.locator('text=Isuzu Elf').count()) > 0);
    await page.click('button:has-text("Restore")');
    await page.waitForTimeout(300);
    await go('#/vehicles');
    check('restored vehicle is back', (await page.locator('.entity', { hasText: 'Isuzu Elf' }).count()) === 1);

    await page.screenshot({ path: path.join(root, 'tests/ui/phone-vehicles.png'), fullPage: true });
    await go('#/');
    await page.screenshot({ path: path.join(root, 'tests/ui/phone-dashboard.png'), fullPage: true });
  } else {
    await go('#/');
    await page.screenshot({ path: path.join(root, 'tests/ui/desktop-dashboard.png'), fullPage: true });
    await go('#/businesses/b1');
    await page.screenshot({ path: path.join(root, 'tests/ui/desktop-business.png'), fullPage: true });
  }
  check(`${label}: no JavaScript errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

await browser.close();
server.close();
for (const [s, n, e] of results) console.log(`${s} ${n}${s === 'FAIL' && e ? ' -> ' + e : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
