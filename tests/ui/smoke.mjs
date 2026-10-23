// Browser smoke test: loads the real app with an in-memory data layer and walks through
// every page and the main flows on a phone-sized and a desktop-sized screen.
// Run: node tests/ui/smoke.mjs   (needs playwright; uses the preinstalled Chromium)
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const types = { '.gz': 'application/gzip', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ics': 'text/calendar', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  let file = p.startsWith('/__mock/') ? path.join(root, 'tests/ui', p.slice(8)) : path.join(root, 'web', p);
  if (p.endsWith('/')) file = path.join(file, 'index.html'); // like GitHub Pages: a folder serves its index.html
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (p === '/index.html') {
    // Point the data layer at the mock, and keep the real Content-Security-Policy so anything it would
    // block on the live site fails here too (only the import map's pinned hash is updated to match).
    body = String(body).replace('"./js/data.js"', '"/__mock/mock-data.js"')
      .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, ''); // web fonts are cosmetic; tests run offline
    const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(body)[1];
    body = body.replace(/'sha256-[^']+'/, `'sha256-${crypto.createHash('sha256').update(map).digest('base64')}'`);
    if (process.env.NO_CSP) body = body.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});
// The renewal guides are generated (not committed): build them so the server has them.
await import('../../scripts/build-city-pages.mjs');
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
// The live site only sells online work for now (no city hall or LTO runs). Most blocks below still turn
// the in-person services on, so they keep working for when they come back; one block checks the
// online-only site the way customers see it.
let inPerson = true;
const openPage = browser.newPage.bind(browser);
browser.newPage = async (opts) => {
  const p = await openPage(opts);
  if (inPerson) await p.addInitScript(() => { globalThis.PP_IN_PERSON = true; });
  return p;
};
const results = [];
const check = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => { globalThis.PP_TEAM = true; }); // a teammate (Marco) and a viewer (Liza)
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

  for (const h of ['#/businesses', '#/businesses/b1', '#/vehicles', '#/vehicles/v1', '#/compliance', '#/documents', '#/pros', '#/network', '#/people', '#/costs', '#/sharing', '#/notifications', '#/history', '#/trash', '#/team', '#/settings', '#/settings/billing', '#/settings/workspace', '#/admin', '#/contact']) {
    await go(h);
    await page.waitForSelector('main h1', { timeout: 5000 }).catch(() => {});
    const t = await page.textContent('main').catch(() => '');
    check(`${label}: ${h} renders`, !!t && !t.includes('Something went wrong'), t.slice(0, 60).replace(/\s+/g, ' '));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label}: ${h} has no sideways scroll`, overflow <= 1, `overflow ${overflow}px`);
  }

  // Menu: a slide-in drawer on phones (closed by default), a fixed sidebar on desktop.
  if (label === 'phone') {
    await go('#/');
    const menuOpen = () => page.evaluate(() => document.querySelector('.shell').classList.contains('menu-open'));
    check('phone: menu starts closed (page gets the full screen)', !(await menuOpen()) && (await page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().right)) <= 0);
    await page.click('[data-act=menu-open]');
    await page.waitForTimeout(350);
    check('phone: ☰ opens the menu', (await menuOpen()) && (await page.locator('.sidebar a[data-nav=history]').isVisible()));
    await page.click('.sidebar a[data-nav=history]');
    await page.waitForTimeout(350);
    check('phone: tapping a menu link opens the page and closes the menu', !(await menuOpen()) && (await page.textContent('main h1')).includes('History'));
    await page.click('[data-act=menu-open]');
    await page.waitForTimeout(350);
    await page.click('.menu-close');
    await page.waitForTimeout(350);
    check('phone: ✕ closes the menu', !(await menuOpen()));
    // Back button with a pop-up open: the pop-up must not stay on screen over the previous page.
    await go('#/businesses/b1');
    await page.click('main [data-act=req-add]');
    await page.waitForSelector('#modal-root .modal');
    await page.goBack();
    await page.waitForTimeout(300);
    check('phone: Back closes an open pop-up', (await page.locator('#modal-root .modal').count()) === 0 && (await page.textContent('main h1')).includes('History'));
  } else {
    check('desktop: sidebar always visible, no ☰ button', (await page.locator('.sidebar').isVisible()) && !(await page.locator('[data-act=menu-open]').isVisible()));
    // Keyboard: "Skip to content" comes first; a pop-up keeps Tab inside it, Escape closes it, focus goes back to its button.
    await go('#/businesses');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Tab');
    check('keyboard: the first Tab stop is "Skip to content"', await page.evaluate(() => document.activeElement?.classList.contains('skip-link')));
    await page.focus('main [data-act=biz-add]'); await page.keyboard.press('Enter'); await page.waitForSelector('#modal-root .modal');
    let left = 0; for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('#modal-root')))) left++; }
    check('keyboard: Tab stays inside an open pop-up', left === 0, `left ${left}x`);
    check('screen readers: pop-ups are announced as dialogs with their title', await page.evaluate(() => { const d = document.querySelector('#modal-root [role=dialog]'); return d?.getAttribute('aria-modal') === 'true' && !!document.getElementById(d.getAttribute('aria-labelledby'))?.textContent; }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check('keyboard: Escape closes the pop-up and returns to its button', (await page.locator('#modal-root .modal').count()) === 0 && await page.evaluate(() => document.activeElement?.dataset?.act === 'biz-add'));
  }

  if (label === 'phone') {
    // Businesses list: one row per business, most urgent first, the overdue one shows its days-late box.
    await go('#/businesses');
    const bizRows = page.locator('.blist .brow');
    check('businesses list: one row per business, overdue first with a days-late box',
      (await bizRows.count()) >= 1 && (await bizRows.first().locator('.days-box.late').count()) === 1 && (await bizRows.first().locator('.brow-req.overdue').count()) === 1);
    await bizRows.first().click();
    await page.waitForTimeout(300);
    check('tapping a business row opens that business', /^#\/businesses\/b\d/.test(await page.evaluate(() => location.hash)));

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

    // Find a professional: a quote request goes to the firm and shows under "Your quote requests".
    await go('#/pros');
    await page.click('[data-act=partner-intro][data-id=p1]');
    await page.fill('.modal [name=note]', "Mayor's Permit renewal for 2 branches");
    await page.selectOption('.modal [name=contact_method]', 'email');
    await page.fill('.modal [name=contact_value]', 'sadie@test.ph');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.modal', { state: 'detached' });
    await page.waitForTimeout(300);
    check('quote request listed', (await page.locator('main .card', { hasText: 'Your quote requests' }).count()) === 1);

    // Import vehicles from a CSV: good rows go in, bad rows are shown and skipped.
    await go('#/vehicles');
    check('vehicle cards: each name has a teal circle with a vehicle icon', await page.evaluate(() => {
      const cards = [...document.querySelectorAll('main .card.entity')];
      return cards.length > 0 && cards.every((c) => c.querySelector('.entity-head .ava svg'));
    }));
    await page.click('[data-act=veh-import]');
    await page.setInputFiles('#imp-file', { name: 'fleet.csv', mimeType: 'text/csv', buffer: Buffer.from(
      'Make and model,Plate number,Type,Registration expires,CTPL expires\n"Mitsubishi L300, FB",ABC 1234,Van,3/10/2027,2027-03-10\nHonda Beat,XYZ 99,Spaceship,,\nIsuzu Elf,NGV 5588,Van,2027-01-05,\n') });
    await page.waitForSelector('.import-sum');
    check('import preview: 1 ready, 2 skipped', (await page.textContent('.import-sum')).includes('1 vehicle ready') && (await page.locator('tr.imp-bad').count()) === 2);
    check('import reads month-first dates', (await page.textContent('#imp-preview tbody tr:first-child')).includes('Mar 10, 2027'));
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.modal', { state: 'detached' });
    check('imported vehicle appears', (await page.locator('.entity', { hasText: 'Mitsubishi L300, FB' }).count()) === 1);

    // Share proof page creates a link and lists it.
    await go('#/sharing');
    await page.click('[data-act=share-pick]');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('#share-url');
    await page.click('[data-modal-close]');
    check('share proof link listed', (await page.locator('main [data-act=share-copy]').count()) === 1);

    // Team tools: start a mall/property trial and invite a tenant (head office is no longer offered).
    await go('#/network');
    check('head office is no longer offered', (await page.locator('[data-act=nb-set-kind][data-kind=head_office]').count()) === 0);
    await page.click('[data-act=nb-set-kind][data-kind=property]');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('main h1:has-text("Tenants")');
    check('menu shows Tenants', (await page.locator('[data-nav=network]').count()) >= 1);
    await page.click('[data-act=nb-add]');
    await page.fill('.modal [name=email]', 'owner@tenant.ph');
    await page.fill('.modal [name=label]', 'G/F Unit 3');
    await page.click('.modal button[type=submit]');
    await page.waitForTimeout(400);
    check('tenant invite waits to connect', (await page.locator('main .card', { hasText: 'owner@tenant.ph' }).count()) === 1);
    // Switch the workspace to fleet: the fleet board shows every vehicle.
    await go('#/settings/workspace');
    await page.click('#kind-form input[value=fleet]');
    await page.click('#kind-form button');
    await page.waitForTimeout(500);
    await go('#/network');
    check('fleet board shows vehicles', (await page.locator('main h1:has-text("Fleet")').count()) === 1 && (await page.locator('.nb-table tbody tr').count()) >= 1);
    await go('#/settings/billing');
    check('plans page shows team plans with prices', (await page.locator('main', { hasText: '₱1,490' }).count()) === 1);
    // Back to a single business for the rest of the tests.
    await go('#/settings/workspace');
    await page.click('#kind-form input[value=business]');
    await page.click('#kind-form button');
    await page.waitForTimeout(500);

    // Notifications: grouped by business, with a task button; ticking one off marks it done.
    await go('#/notifications');
    check('notifications grouped by business', (await page.locator('.ngroup .ng-head', { hasText: 'Corner <Bakery> & Co' }).count()) === 1);
    const before = await page.locator('.ng-row.new').count();
    await page.click('.ng-row.new [data-act=notif-done]');
    await page.waitForTimeout(300);
    check('ticking a notification marks it done', (await page.locator('.ng-row.new').count()) === before - 1);
    // Bell drop-down opens from any page and links to the full list.
    await go('#/');
    await page.click('[data-act=bell-open]');
    await page.waitForSelector('.bell-drop .bd-all');
    check('bell drop-down lists notifications', (await page.locator('.bell-drop .bd-item').count()) >= 1);
    await page.keyboard.press('Escape');
    check('bell drop-down closes with Escape', (await page.locator('.bell-drop').count()) === 0);

    // Menu: Notifications first, then the color-coded TOOLS and ACCOUNT groups.
    const order = await page.evaluate(() => [...document.querySelectorAll('.sidebar .nav-secondary > *')].map((e) => e.classList.contains('nav-group') ? e.textContent.trim().toUpperCase() : e.dataset.nav));
    check('menu: Notifications above TOOLS, then ACCOUNT', order[0] === 'notifications' && order[1] === 'TOOLS' && order.indexOf('ACCOUNT') > order.indexOf('sharing'), order.join(','));

    // Removing a staff license that doesn't apply returns to that staff member (it used to go to a missing vehicle page).
    await go('#/people');
    await page.click('main [data-act=person-add]');
    await page.fill('.modal [name=full_name]', 'Ana Cruz');
    await page.check('.modal [name=types]');
    await page.check('.modal [name=consent]');
    await page.click('.modal button[type=submit]');
    await page.waitForTimeout(500);
    const personHash = await page.evaluate(() => location.hash);
    const licHref = await page.evaluate(() => document.querySelector('main [data-href^="#/requirement/"]')?.dataset.href || document.querySelector('main a[href^="#/requirement/"]')?.getAttribute('href'));
    await go(licHref);
    await page.click('main [data-act=req-delete]');
    await page.waitForSelector('.modal');
    await page.click('.modal button[type=submit]');
    await page.waitForTimeout(500);
    check('removing a staff license returns to that staff member', personHash.startsWith('#/people/') && (await page.evaluate(() => location.hash)) === personHash, personHash);
    await go('#/people');
    check('staff cards: the name has a teal circle with initials', await page.evaluate(() =>
      [...document.querySelectorAll('main .card.entity')].some((c) => c.querySelector('h2')?.textContent.includes('Ana Cruz') && c.querySelector('.ava')?.textContent.trim() === 'AC')));

    // History: the drop-down really filters (it used to show the same list whatever was picked).
    await go('#/history');
    const histAll = await page.locator('.hist-line').count();
    await page.selectOption('#hist-show', 'team'); await page.waitForTimeout(250);
    const histTeam = await page.locator('.hist-line').count();
    const histEmpty = await page.locator('main .empty').count();
    await page.selectOption('#hist-show', 'businesses'); await page.waitForTimeout(250);
    const histBiz = await page.locator('.hist-line').count();
    await page.selectOption('#hist-show', ''); await page.waitForTimeout(250);
    check('History filter changes the list', histAll > 0 && histTeam === 0 && histEmpty === 1 && histBiz >= 1 && histBiz <= histAll
      && (await page.locator('.hist-line').count()) === histAll, `all ${histAll} team ${histTeam} biz ${histBiz}`);

    // Contact Pinoy Permit: an empty message is refused with a message, a filled one is sent.
    await go('#/contact');
    await page.fill('#contact-form textarea[name=message]', 'Hello, testing the contact form.');
    await page.click('#contact-form button');
    await page.waitForTimeout(300);
    check('Contact form sends a message', await page.locator('.contact-done:not([hidden])').count() === 1);

    // Compliance filters: Clear brings every row back.
    await go('#/compliance');
    const allRows = await page.locator('main .row').count();
    await page.click('[data-act=filter-status][data-v=action_required]');
    await page.waitForTimeout(250);
    check('status chip narrows the compliance list', (await page.locator('main .row').count()) < allRows);
    await page.click('[data-act=clear-filters]');
    await page.waitForTimeout(250);
    check('Clear resets the compliance filters', (await page.locator('main .row').count()) === allRows);
    // Search: pausing mid-word (the list redraws) must not move the cursor ("ma" + "yor" stays "mayor").
    await page.click('main [name=q]');
    await page.keyboard.type('ma', { delay: 30 });
    await page.waitForTimeout(400);
    await page.keyboard.type('yor', { delay: 30 });
    await page.waitForTimeout(400);
    check('typing in search with a pause keeps the words in order', (await page.inputValue('main [name=q]')) === 'mayor' && (await page.locator('main .row').count()) >= 1);
    // A leftover search must not hide anything when you arrive from a number tile.
    await go('#/');
    const dashOverdue = Number((await page.textContent('main .stat.overdue .stat-n')).trim());
    await page.click('main .stat.overdue');
    await page.waitForTimeout(300);
    check('dashboard "Overdue" tile shows exactly that many permits', (await page.locator('main .row').count()) === dashOverdue && (await page.inputValue('main [name=q]')) === '', `tile ${dashOverdue}`);
    // Number tiles on a business page open the list for that business only, so the count matches.
    await go('#/businesses/b1');
    const bizOverdue = Number((await page.textContent('main .stat.overdue .stat-n')).trim());
    await page.click('main .stat.overdue');
    await page.waitForTimeout(300);
    check('a business page tile opens only that business\'s permits', (await page.locator('main .row').count()) === bizOverdue
      && (await page.inputValue('#filters [name=entity]')) === 'business:b1', `tile ${bizOverdue}`);
    await page.click('[data-act=clear-filters]');
    await page.waitForTimeout(250);

    // Who's handling it: pills, the "handled by" filter, assigning several at once, changing one, leaving the team.
    await go('#/compliance');
    check('compliance rows show who handles them', (await page.locator('main .row .who').count()) === 3, String(await page.locator('main .row .who').count()));
    await go('#/compliance?who=me');
    check('"handled by me" shows only my permits', (await page.locator('main .row').count()) === 1 && (await page.locator('main .row .who', { hasText: 'You' }).count()) === 1);
    await page.click('[data-act=clear-filters]'); await page.waitForTimeout(250);
    await go('#/compliance?who=nobody');
    const nobodyBefore = await page.locator('main .row').count();
    await page.click('[data-act=bulk-toggle]'); await page.waitForTimeout(250);
    check('"Assign several" puts a tick box on every row', (await page.locator('main .row .row-pick input').count()) === nobodyBefore && nobodyBefore > 2);
    check('Assign button waits until something is ticked', await page.locator('.bulk-bar [data-act=bulk-assign]').isDisabled());
    await page.locator('main .row .row-pick input').nth(0).check();
    await page.locator('main .row .row-pick input').nth(1).check();
    check('the bar counts what is ticked', (await page.textContent('.bulk-bar b')).trim() === '2');
    await page.click('.bulk-bar [data-act=bulk-assign]');
    check('viewers are not offered as handlers', (await page.locator('.modal .pick', { hasText: 'Liza' }).count()) === 0 && (await page.locator('.modal .pick', { hasText: 'Marco Santos' }).count()) === 1);
    check('the current handler (Nobody) is already chosen', await page.isChecked('.modal input[name=who][value=""]'));
    await page.check('.modal input[name=who][value=u2]');
    await page.click('.modal button[type=submit]'); await page.waitForTimeout(400);
    check('assigning two says who and how many', /2 permits now handled by Marco Santos\. We let them know\./.test(await page.textContent('#toast')), await page.textContent('#toast'));
    check('assigned permits leave the "handled by nobody" list and choosing ends', (await page.locator('main .row').count()) === nobodyBefore - 2 && (await page.locator('.bulk-bar').count()) === 0);
    await page.click('[data-act=clear-filters]'); await page.waitForTimeout(250);
    await go('#/compliance?who=u2');
    const marcoRows = await page.locator('main .row').count();
    check('Marco now handles 4', marcoRows === 4, String(marcoRows));
    await page.locator('main .row').first().click(); await page.waitForTimeout(300);
    check('a permit page says who handles it', /Handled by Marco Santos/.test(await page.textContent('main .handled')));
    await page.click('main .handled [data-act=req-assign]');
    await page.check('.modal input[name=who][value=""]');
    await page.click('.modal button[type=submit]'); await page.waitForTimeout(400);
    check('handing a permit back to nobody says everyone gets reminders', /Nobody is handling this yet/.test(await page.textContent('main .handled')));
    await go('#/team');
    check('team page shows how many permits each person handles', (await page.locator('main .row', { hasText: 'Marco Santos' }).locator('text=handles 3 permits').count()) === 1);
    await page.click('main [data-act=member-remove][data-name="Marco Santos"]');
    check('removing someone warns about the permits they handle', /They handle 3 permits/.test(await page.textContent('#modal-root')));
    await page.click('.modal button[type=submit]'); await page.waitForTimeout(400);
    await go('#/compliance');
    check('after they leave, nothing shows them as handler', (await page.locator('main .row .who', { hasText: 'Marco' }).count()) === 0);
    await go('#/settings/workspace');
    await page.selectOption('#esc-days', '14');
    await page.click('#esc-form button'); await page.waitForTimeout(300);
    check('owner can change when they are alerted', /14 days/.test(await page.textContent('#toast')) || /Saved/.test(await page.textContent('#toast')), await page.textContent('#toast'));

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

// Renewal checklist, the fuller permit library, and the done-for-you service from request to finished permit.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(300); };
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  const mpId = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'mayors_permit' && r.business_id === 'b1').id));
  await go('#/requirement/' + mpId);
  check('checklist: open on an overdue permit, with where to file', await page.locator('details.checklist[open]').count() === 1 && /BPLO/.test(await page.textContent('.checklist .ck-facts')));
  check('checklist: "do these first" offers to add the missing barangay clearance', (await page.locator('.ck-dep.missing', { hasText: 'Barangay Business Clearance' }).locator('[data-act=req-add]').count()) === 1);
  check('checklist: a step tracked elsewhere shows its live status', /In Pinoy Permit: Compliant until/.test(await page.textContent('.ck-list')));
  check('checklist: starts at 0 ready', (await page.textContent('.ck-count')).includes('0 of 6'));
  check('checklist: the "already filed?" hint waits for a tick', await page.locator('[data-ck-hint]').isHidden());
  await page.check('[data-ck=prev]'); await page.waitForTimeout(250);
  check('checklist: ticking counts and says who ticked it', (await page.textContent('.ck-count')).includes('1 of 6') && /Ticked by you/.test(await page.textContent('.ck-list li.done')));
  check('checklist: after a tick, it reminds you to mark the renewal started', await page.locator('[data-ck-hint]').isVisible());
  await go('#/'); await go('#/requirement/' + mpId);
  check('checklist: ticks are still there after leaving the page', await page.isChecked('[data-ck=prev]') && (await page.textContent('.ck-count')).includes('1 of 6'));
  await page.uncheck('[data-ck=prev]'); await page.waitForTimeout(250);
  check('checklist: unticking counts down', (await page.textContent('.ck-count')).includes('0 of 6'));
  const ltoId = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'lto_registration').id));
  await go('#/requirement/' + ltoId);
  const ext = page.locator('.checklist .ck-facts a.ext-link').first();
  check('checklist: official portal link opens safely in a new tab', (await ext.getAttribute('href')) === 'https://portal.lto.gov.ph/' && (await ext.getAttribute('target')) === '_blank' && /noopener/.test(await ext.getAttribute('rel')));

  // The library, grouped, with the ones made for this kind of business first.
  await go('#/businesses/b1');
  check('library: "Often needed for" a restaurant lists the liquor license', (await page.locator('.lib-group', { hasText: 'Often needed for Restaurant' }).count()) === 1
    && (await page.locator('.suggest-list button[data-type=liquor_license]').count()) === 1);
  check('library: the rest is grouped by category', (await page.locator('.lib-more .lib-group', { hasText: 'Employer registrations' }).count()) === 1);

  // Done for you: menu, catalog, asking for a quote.
  check('done for you: in the menu', (await page.locator('.sidebar a[data-nav=services]').count()) === 1);
  await go('#/requirement/' + mpId);
  check('done for you: offered on the permit page with the starting price', /Have Pinoy Permit renew it for you/.test(await page.textContent('.checklist .offer-inline')) && /₱6,000/.test(await page.textContent('.checklist .offer-inline')));
  await page.click('.checklist .offer-inline [data-act=svc-for-req]');
  check('done for you: the quote form picks this permit and "renew"', (await page.inputValue('.modal select[name=target]')) === mpId && await page.isChecked('.modal input[name=kind][value=renew]'));
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(200);
  check('done for you: no request without the authorization tick', /Please tick the box/.test(await page.textContent('#modal-root .modal-error')) && (await page.locator('#modal-root .modal').count()) === 1);
  await page.check('.modal input[name=consent]');
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(500);
  const orderHash = await page.evaluate(() => location.hash);
  check('done for you: sent straight to the request, waiting for a quote', /^#\/services\/orders\//.test(orderHash) && /preparing your exact quote/i.test(await page.textContent('main')));
  check('done for you: the progress steps start at "Request sent"', (await page.textContent('.stepper li.now')).includes('Request sent'));
  await page.click('[data-act=auth-letter]');
  check('done for you: the authorization letter names the business and permit', /Corner <Bakery> & Co/.test(await page.textContent('.letter')) && /Mayor's \/ Business Permit/.test(await page.textContent('.letter')));
  await page.click('.modal [data-modal-close]'); await page.waitForTimeout(150);
  await go('#/requirement/' + mpId);
  check('done for you: the permit now says Pinoy Permit is handling it', /Pinoy Permit is handling this/.test(await page.textContent('main .banner.progress')) && (await page.locator('.checklist .offer-inline', { hasText: 'Open request' }).count()) === 1);
  await page.click('.checklist .offer-inline a'); await page.waitForTimeout(300);
  check('done for you: "Open request" goes back to the same request', (await page.evaluate(() => location.hash)) === orderHash);

  // Staff: quote it.
  await go('#/admin');
  await page.click('[data-act=admin-tab][data-tab=orders]'); await page.waitForTimeout(300);
  check('admin: the new request waits under "send a quote"', (await page.locator('main .card', { hasText: 'New: send a quote' }).locator('.line', { hasText: "Renewal: Mayor's" }).count()) === 1);
  await page.locator('main .line', { hasText: "Renewal: Mayor's" }).click(); await page.waitForTimeout(300);
  check('admin: shows when the customer authorized it', /ticked in the app/.test(await page.textContent('main .kv')));
  await page.fill('.admin-quote [name=fee]', '2500'); await page.fill('.admin-quote [name=gov]', '4200');
  await page.click('.admin-quote button'); await page.waitForTimeout(300);

  // Customer: accept, pay.
  await go(orderHash);
  check('order: the quote adds up', (await page.textContent('.qline.total')).includes('6,700'));
  await page.click('[data-act=quote-accept]'); await page.click('.modal button[type=submit]'); await page.waitForTimeout(400);
  check('order: after accepting, payment details show', (await page.locator('.pay-form').count()) === 1 && /0917 000 0000/.test(await page.textContent('.paywiths')));
  await page.click('.pay-form button[type=submit]'); await page.waitForTimeout(200);
  check('order: "I\'ve paid" needs a reference or a screenshot', /reference number or a screenshot/.test(await page.textContent('#toast')));
  await page.fill('.pay-form [name=ref]', '1009 234 567890');
  await page.click('.pay-form button[type=submit]'); await page.waitForTimeout(400);
  check('order: then it says the payment is being checked', /checking your payment/i.test(await page.textContent('main')));

  // Staff: confirm, finish with the new permit.
  await go('#/admin');
  await page.click('[data-act=admin-tab][data-tab=orders]'); await page.waitForTimeout(300);
  check('admin: the payment waits under "Payment to check"', (await page.locator('main .card', { hasText: 'Payment to check' }).locator('.line').count()) === 1);
  await page.locator('main .line', { hasText: "Renewal: Mayor's" }).click(); await page.waitForTimeout(300);
  await page.click('[data-act=admin-pay][data-ok="1"]'); await page.waitForTimeout(300);
  await page.fill('.admin-renewal [name=reference_no]', 'MP-2027-0001');
  await page.fill('.admin-renewal [name=expires_on]', '2027-12-31');
  await page.click('.admin-renewal button'); await page.click('.modal button[type=submit]'); await page.waitForTimeout(400);
  await go(orderHash);
  check('order: done, and the new permit is linked', /Done\./.test(await page.textContent('main .banner')) && (await page.locator('.stepper li.done').count()) === 5);
  await go('#/requirement/' + mpId);
  check('order: the permit now shows the new record and a fresh checklist', /MP-2027-0001/.test(await page.textContent('main .kv')) && (await page.textContent('.ck-count')).includes('0 of 6'));
  await go('#/services');
  check('done for you page: lists the request as completed', (await page.locator('main .line', { hasText: 'Completed' }).count()) === 1);
  check('done for you page: every service has a "Get a quote" button', (await page.locator('.svc-grid .svc').count()) === (await page.locator('.svc-grid [data-act=svc-request]').count()));
  check('done for you: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// Taxes & contributions: set up a business, see the deadlines, mark one filed, undo it.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  check('filings: in the menu', (await page.locator('.sidebar a[data-nav=filings]').count()) === 1);
  await go('#/filings');
  check('filings: asks to set up each business first', (await page.locator('.setup-card .line', { hasText: 'Corner <Bakery> & Co' }).count()) === 1);
  await page.click('.setup-card [data-act=filing-setup]'); await page.waitForTimeout(250);
  check('filings: the 8% option is only for sole proprietors', (await page.locator('.modal input[name=tax_type][value=eight_percent]').count()) === 0);
  check('filings: employer numbers stay hidden until "has employees"', await page.locator('.modal .q-employer').isHidden());
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(200);
  check('filings: saving without answers says what is missing', /answer questions 1 to 3/i.test(await page.textContent('#modal-root .modal-error')));
  await page.check('.modal input[name=has_employees][value=yes]');
  await page.check('.modal input[name=tax_type][value=vat]');
  await page.check('.modal input[name=withholds][value=yes]');
  await page.waitForTimeout(150);
  check('filings: employer numbers appear once "has employees" is ticked', await page.locator('.modal .q-employer').isVisible());
  check('filings: Pag-IBIG group is suggested from the business name', (await page.inputValue('.modal select[name=pagibig_group]')) === 'A-D');
  const before = (await page.textContent('.filing-preview h3')).trim();
  await page.uncheck('.modal [data-track=sec_afs]'); await page.waitForTimeout(150);
  const after = (await page.textContent('.filing-preview h3')).trim();
  check('filings: the preview lists what will be tracked, and unticking one counts down', /We'll track 1[0-9] filings/.test(before) && Number(after.match(/\d+/)[0]) === Number(before.match(/\d+/)[0]) - 1, `${before} -> ${after}`);
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(500);
  check('filings: saved, and the deadlines are listed', /deadlines are listed/.test(await page.textContent('#toast')) && (await page.locator('main .filing-row').count()) > 0);
  check('filings: a turned-off filing is not listed', (await page.locator('main .filing-row', { hasText: 'Audited financial statements' }).count()) === 0);
  const lateRows = await page.locator('main .card:has(h2:text-is("Late")) .filing-row').count();
  check('filings: late ones are listed first with how many days late', lateRows > 0 && /days? late/.test(await page.textContent('main .card:has(h2:text-is("Late")) .chip')), String(lateRows));
  check('filings: each row says the period and the business', /For (January|February|March|April|May|June|July|August|September|October|November|December) \d{4} · Corner <Bakery> & Co/.test(await page.textContent('main .filing-row')));
  const firstTitle = await page.textContent('main .filing-row .row-title');
  await page.locator('main .filing-row [data-act=filing-mark]').first().click(); await page.waitForTimeout(250);
  check('filings: marking filed explains which filing and period', /for/.test(await page.textContent('.modal .muted.small')) && (await page.inputValue('.modal [name=filed_on]')).length === 10);
  const due = await page.evaluate(() => document.querySelector('.modal .muted.small').textContent.match(/due (.*)$/)[1]);
  await page.fill('.modal [name=reference]', 'PRN-0042');
  await page.fill('.modal [name=amount]', '4250');
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(450);
  check('filings: marked filed leaves the to-do list', /Marked filed/.test(await page.textContent('#toast')) && (await page.locator('main .card:has(h2:text-is("Late")) .filing-row').count()) === lateRows - 1, due);
  await page.click('main .filing-filters [data-act=filing-view][data-v=filed]'); await page.waitForTimeout(300);
  check('filings: the Filed list shows it with the reference and amount', (await page.locator('main .filing-row', { hasText: 'PRN-0042' }).count()) === 1 && /₱4,250/.test(await page.textContent('main .filing-row')));
  check('filings: and how late it was', /days late/.test(await page.textContent('main .filed-line')));
  await page.click('main .filing-row [data-act=filing-mark]'); await page.waitForTimeout(250);
  await page.click('.modal [data-act=filing-unmark]'); await page.waitForTimeout(200);
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(450);
  check('filings: removing the record puts it back on the to-do list', /back on the to-do list/.test(await page.textContent('#toast')) && (await page.locator('main .filing-row').count()) === 0);
  await page.click('main .filing-filters [data-act=filing-view][data-v=todo]'); await page.waitForTimeout(300);
  check('filings: ...where it is late again', (await page.locator('main .card:has(h2:text-is("Late")) .filing-row').count()) === lateRows);
  await page.locator('main .filing-row [data-act=filing-mark]').first().click(); await page.waitForTimeout(250);
  const tomorrow = await page.evaluate(() => { const d = new Date(new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); });
  await page.fill('.modal [name=filed_on]', tomorrow);
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(200);
  check('filings: a date in the future is refused', /future/.test(await page.textContent('#modal-root .modal-error')));
  await page.click('.modal [data-modal-close]'); await page.waitForTimeout(150);
  await go('#/');
  await page.waitForTimeout(300);
  check('filings: the dashboard mentions late tax filings', /tax filings? late/.test(await page.textContent('[data-filings-brief]')) && await page.locator('[data-filings-brief]').isVisible());
  check('filings: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// Spreadsheet import: businesses from CSV (with guesses explained), permit records from Excel.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(300); };
  await page.goto('http://localhost:4173/#/businesses');
  await page.waitForSelector('main h1');
  await page.click('main [data-act=imp-open][data-kind=businesses]');
  check('import: opens on the right kind', (await page.inputValue('#imp-kind')) === 'businesses');
  await page.setInputFiles('#imp-file', { name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(
    'Our businesses\nBusiness name,Industry,Structure,City\nLola Nena Bakeshop,Bakery,,Quezon City\nCorner <Bakery> & Co,,,\nMabuhay Trading Inc.,Wholesale,,Pasig\n') });
  await page.waitForSelector('.import-sum');
  check('import: finds the headings under a title row and counts what is ready', /2 businesses ready/.test(await page.textContent('.import-sum')) && (await page.locator('tr.imp-bad').count()) === 1);
  check('import: says what it guessed', (await page.locator('tr.imp-note .imp-notes', { hasText: 'set to Corporation because of the name' }).count()) === 1);
  check('import: the button says how many', /Import 2 businesses/.test(await page.textContent('.modal button[type=submit]')));
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('#modal-root .modal', { state: 'detached' });
  check('import: the businesses are added with their permit lists', (await page.locator('main', { hasText: 'Lola Nena Bakeshop' }).count()) === 1 && /2 businesses imported/.test(await page.textContent('#toast')));

  await go('#/compliance');
  await page.click('main [data-act=imp-open][data-kind=permits]');
  await page.setInputFiles('#imp-file', path.join(root, 'tests/ui/fixtures/permits.xlsx'));
  await page.waitForSelector('.import-sum');
  check('import: Excel files work, and the sheet with the right columns is picked', (await page.inputValue('#imp-sheet-pick')) === '1' && /2 permit records ready/.test(await page.textContent('.import-sum')));
  check('import: Excel dates come through as dates', /Jan 20, 2027/.test(await page.textContent('#imp-preview tbody')) && /Apr 30, 2027/.test(await page.textContent('#imp-preview tbody')));
  check('import: newer records are saved as renewals', (await page.locator('.imp-notes', { hasText: 'Saved as the newest record' }).count()) === 2);
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('#modal-root .modal', { state: 'detached' });
  const mp = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'mayors_permit' && r.business_id === 'b1')));
  check('import: the permit now has the new number and date', mp.reference_no === 'BP-2027-77' && mp.expires_on === '2027-01-20', `${mp.reference_no} ${mp.expires_on}`);
  await page.click('main [data-act=imp-open][data-kind=permits]');
  await page.setInputFiles('#imp-file', path.join(root, 'tests/ui/fixtures/permits.xlsx'));
  await page.waitForSelector('.import-sum');
  check('import: importing the same file again changes nothing', /0 permit records ready/.test(await page.textContent('.import-sum')) && /2 already up to date/.test(await page.textContent('.import-sum'))
    && await page.locator('.modal button[type=submit]').isDisabled());
  await page.click('.modal [data-modal-close]');
  await page.click('main [data-act=imp-open][data-kind=permits]');
  await page.setInputFiles('#imp-file', { name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('xx') });
  await page.waitForTimeout(200);
  check('import: old .xls files get a clear "save as .xlsx" message', /save it as \.xlsx or CSV/.test(await page.textContent('#imp-preview')));
  await page.selectOption('#imp-kind', 'vehicles');
  await page.setInputFiles('#imp-file', { name: 'v.csv', mimeType: 'text/csv', buffer: Buffer.from('Make and model,Registration expires\nL300,03/04/2027\n') });
  await page.waitForSelector('.import-sum');
  check('import: ambiguous dates ask which way to read them', (await page.locator('.date-choice').count()) === 1 && /Mar 4, 2027/.test(await page.textContent('#imp-preview tbody')));
  await page.check('.date-choice input[value="1"]'); await page.waitForTimeout(150);
  check('import: choosing "day first" reads them again', /Apr 3, 2027/.test(await page.textContent('#imp-preview tbody')));
  check('import: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// Fill from a photo: the real reader (served from our site, under the real security policy) reads a
// drawn permit, fills the empty boxes, attaches the photo, and saving waits for "I checked".
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  const png = Buffer.from((await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1400; c.height = 1000;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#111';
    g.font = 'bold 54px sans-serif'; g.fillText("MAYOR'S PERMIT", 380, 120);
    g.font = '40px sans-serif';
    ['CITY OF MAKATI', 'Business Permits and Licensing Office', 'Permit No.: BP-2026-0442', 'Business: CORNER BAKERY CORP.',
     'Date Issued: January 15, 2026', 'Valid until: December 31, 2026'].forEach((t, i) => g.fillText(t, 120, 240 + i * 110));
    return c.toDataURL('image/png').split(',')[1];
  })), 'base64');
  const mp = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'mayors_permit' && r.business_id === 'b1').id));
  await page.evaluate((id) => { location.hash = '#/requirement/' + id; }, mp); await page.waitForTimeout(400);
  await page.locator('main [data-act=req-renew]').first().click();
  await page.waitForSelector('.modal .scan-box');
  await page.setInputFiles('.modal [data-scan-file]', { name: 'permit.png', mimeType: 'image/png', buffer: png });
  const t0 = Date.now();
  await page.waitForSelector('.modal .scan-result, .modal .scan-status .form-error', { timeout: 150000 });
  const secs = Math.round((Date.now() - t0) / 1000);
  check('photo: the reader runs on the device under the security policy', (await page.locator('.modal .scan-result').count()) === 1, (await page.textContent('.modal .scan-status')).slice(0, 160) + ` (${secs}s)`);
  check('photo: fills the expiry, issue date and permit number', (await page.inputValue('.modal [name=expires_on]')) === '2026-12-31'
    && (await page.inputValue('.modal [name=issued_on]')) === '2026-01-15' && (await page.inputValue('.modal [name=reference_no]')) === 'BP-2026-0442',
    `${await page.inputValue('.modal [name=expires_on]')} ${await page.inputValue('.modal [name=issued_on]')} ${await page.inputValue('.modal [name=reference_no]')}`);
  check('photo: filled boxes are highlighted', (await page.locator('.modal input.from-scan').count()) === 3);
  check('photo: the photo is attached as the new document', await page.evaluate(() => document.querySelector('.modal input[type=file][name=file]').files.length === 1));
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(200);
  check('photo: saving waits for "I checked these against the document"', /I checked the filled-in details/.test(await page.textContent('#modal-root .modal-error')));
  await page.check('.modal [name=scan_ok]');
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(600);
  check('photo: saved with the details from the photo', /BP-2026-0442/.test(await page.textContent('main .kv')) && /Dec 31, 2026/.test(await page.textContent('main .kv')));
  // the wrong photo for a permit is called out
  const fsic = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'fsic' && r.business_id === 'b1').id));
  await page.evaluate((id) => { location.hash = '#/requirement/' + id; }, fsic); await page.waitForTimeout(400);
  await page.locator('main [data-act=req-renew]').first().click();
  await page.waitForSelector('.modal .scan-box');
  await page.setInputFiles('.modal [data-scan-file]', { name: 'permit.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.modal .scan-result, .modal .scan-status .form-error', { timeout: 150000 });
  check('photo: a photo of a different permit gets "Is this the right photo?"', /Is this the right photo\?/.test(await page.textContent('.modal .scan-result')));
  await page.click('.modal [data-modal-close]');
  check('photo: no JavaScript or security-policy errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// Text messages: who can get them, verifying a number with a code, changing and removing it.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4173/#/settings');
  await page.waitForSelector('main h1');
  check('texts: while texting is being set up, says so', /being set up/.test(await page.textContent('#sms')));
  check('texts: the number lives in its own section, not the profile form', (await page.locator('#profile-form [name=phone]').count()) === 0);
  await page.addInitScript(() => { globalThis.PP_SMS = true; });
  await page.reload(); await page.waitForSelector('#sms');
  check('texts: on the Free plan, texts run on text credits from load, after verifying the number', /text reminders left|No text credits yet/.test(await page.textContent('#sms')) && (await page.locator('#sms-start [name=phone]').count()) === 1);
  await page.addInitScript(() => { globalThis.PP_FEATURES = ['errors', 'assign', 'library2', 'services', 'filings', 'sms', 'mfa', 'revenue', 'plus']; });
  await page.reload(); await page.waitForSelector('#sms');
  check('texts: on the Free plan without load, explains they come with team plans', /come with team plans/.test(await page.textContent('#sms')));
  await page.addInitScript(() => { globalThis.PP_SMS = true; globalThis.PP_PLAN = 'fleet'; globalThis.PP_FEATURES = undefined; });
  await page.reload(); await page.waitForSelector('#sms');
  await page.fill('#sms-start [name=phone]', '12345'); await page.click('#sms-start button'); await page.waitForTimeout(200);
  check('texts: a number that is not a PH mobile is refused', /Philippine mobile/.test(await page.textContent('#toast')));
  await page.fill('#sms-start [name=phone]', '0917-123-4567'); await page.click('#sms-start button'); await page.waitForTimeout(300);
  check('texts: says where the code went', /0917 123 4567/.test(await page.textContent('#sms')) && (await page.locator('#sms-code [name=code]').count()) === 1);
  check('texts: "send again" waits a minute', await page.locator('[data-act=sms-resend]').isDisabled() && /Send again in \d+s/.test(await page.textContent('[data-act=sms-resend]')));
  await page.fill('#sms-code [name=code]', '000000'); await page.click('#sms-code button:not([type=button])'); await page.waitForTimeout(200);
  check('texts: a wrong code says how many tries are left', /4 tries left/.test(await page.textContent('#toast')));
  await page.fill('#sms-code [name=code]', '123 456'); await page.click('#sms-code button:not([type=button])'); await page.waitForTimeout(400);
  check('texts: the right code verifies the number and turns texts on', /Verified/.test(await page.textContent('#sms')) && await page.isChecked('#sms [data-pref=sms_enabled]'));
  await page.click('#sms [data-act=sms-change]'); await page.waitForTimeout(200);
  check('texts: changing the number asks for a new one, and can be cancelled', (await page.locator('#sms-start').count()) === 1 && /Cancel: keep 0917 123 4567/.test(await page.textContent('#sms')));
  await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(250);
  await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForTimeout(350);
  check('texts: until a new number is verified, texts keep going to the old one', /Verified/.test(await page.textContent('#sms')));
  await page.click('#sms [data-act=sms-remove]'); await page.click('.modal button[type=submit]'); await page.waitForTimeout(300);
  check('texts: removing the number stops texts', (await page.locator('#sms-start').count()) === 1 && /No more texts/.test(await page.textContent('#toast')));
  check('texts: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// Two-step login: turning it on, the code screen at sign-in, a workspace that requires it, lost phone.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4173/#/settings');
  await page.waitForSelector('#mfa-section [data-act]');
  check('two-step: off by default, with a plain explanation', /stolen or guessed password/.test(await page.textContent('#mfa-section')));
  await page.click('#mfa-section [data-act=mfa-on]'); await page.waitForSelector('.modal .qr img');
  check('two-step: shows a QR code and the key, grouped for typing', /JBSW Y3DP/.test(await page.textContent('.modal .secret')));
  await page.fill('.modal [name=code]', '111111'); await page.click('.modal button[type=submit]'); await page.waitForTimeout(200);
  check('two-step: a wrong code explains what to check', /Codes change every 30 seconds/.test(await page.textContent('#modal-root .modal-error')));
  await page.fill('.modal [name=code]', '123 456'); await page.click('.modal button[type=submit]'); await page.waitForTimeout(400);
  check('two-step: turned on, and it suggests a second device', /On\./.test(await page.textContent('#mfa-section')) && /Add a second device/.test(await page.textContent('#mfa-section')));
  await page.click('#mfa-section [data-act=mfa-add]'); await page.waitForSelector('.modal .qr img');
  await page.click('.modal [data-modal-close]'); await page.waitForTimeout(300);
  check('two-step: closing a half-finished setup leaves no extra device behind', (await page.locator('#mfa-section [data-act=mfa-remove]').count()) === 1);
  await page.evaluate(() => { location.hash = '#/settings/workspace'; }); await page.waitForTimeout(400);
  await page.locator('label.toggle:has([data-act-change=require-mfa])').click(); await page.waitForTimeout(250);
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(400);
  check('two-step: the owner can require it for the workspace', await page.isChecked('[data-act-change=require-mfa]') && /Everyone now needs two-step login/.test(await page.textContent('#toast')));
  await page.close();

  // signing in when it is on
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.addInitScript(() => { globalThis.PP_MFA_ON = true; });
  await p2.goto('http://localhost:4173/');
  await p2.waitForSelector('#mfa-form');
  check('two-step: after the password, it asks for the code', /6-digit code/.test(await p2.textContent('.auth-card')) && (await p2.locator('.sidebar').count()) === 0);
  await p2.fill('#mfa-form [name=code]', '12345'); await p2.click('#mfa-form button'); await p2.waitForTimeout(150);
  check('two-step: a short code is caught before sending', /Type the 6-digit code/.test(await p2.textContent('#mfa-form .form-error')));
  await p2.fill('#mfa-form [name=code]', '654321'); await p2.click('#mfa-form button'); await p2.waitForTimeout(300);
  check('two-step: a wrong code explains what to check', /didn't work/.test(await p2.textContent('#mfa-form .form-error')));
  check('two-step: "lost your phone" explains the way back in', /confirm it's really you/.test(await p2.textContent('details.lost')));
  await p2.fill('#mfa-form [name=code]', '123456'); await p2.click('#mfa-form button');
  await p2.waitForSelector('main h1');
  check('two-step: the right code opens the app', (await p2.locator('.sidebar').count()) === 1);
  await p2.close();

  // a workspace that requires it, for someone who hasn't set it up
  const p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p3.on('pageerror', (e) => errs.push(e.message));
  await p3.addInitScript(() => { globalThis.PP_LOCKED = true; });
  await p3.goto('http://localhost:4173/');
  await p3.waitForSelector('[data-act=mfa-setup-now]');
  check('two-step: a workspace that requires it says so, by name', /Secure Co<\/b> requires two-step login|Secure Co requires two-step login/.test(await p3.innerHTML('.auth-card')));
  await p3.click('[data-act=mfa-setup-now]'); await p3.waitForSelector('.modal .qr img');
  await p3.fill('.modal [name=code]', '123456'); await p3.click('.modal button[type=submit]');
  await p3.waitForSelector('main h1');
  check('two-step: once set up, the app opens', (await p3.locator('.sidebar').count()) === 1);
  await p3.close();
  check('two-step: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
}

// Error reporting: a crash in the browser is sent (scrubbed of personal details) and staff see it in Admin.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto('http://localhost:4173/#/compliance');
  await page.waitForSelector('main h1');
  await page.evaluate(() => { setTimeout(() => { throw new Error('Boom for sadie@test.ph on 09171234567 order 12345678'); }, 0); });
  await page.evaluate(() => { Promise.reject(new TypeError("Cannot read properties of undefined (reading 'x')")); });
  await page.evaluate(() => { Promise.reject(new TypeError('Failed to fetch')); }); // a dropped connection is not a bug
  await page.waitForTimeout(300);
  const sent = await page.evaluate(() => globalThis.__ppMockErrors.map((e) => `${e.message} @ ${e.route}`));
  check('errors: a crash is reported', sent.some((m) => m.startsWith('Boom for')), sent.join(' | '));
  check('errors: emails, phone numbers and long numbers are removed', sent.some((m) => m.includes('[email]') && m.includes('[phone]') && m.includes('#')) && !sent.join().includes('sadie@'));
  check('errors: an unhandled promise failure is reported', sent.some((m) => m.startsWith('TypeError: Cannot read')));
  check('errors: a lost connection is not reported', !sent.some((m) => m.includes('Failed to fetch')));
  check('errors: the page is recorded without ids', sent.every((m) => m.endsWith('@ #/compliance')));
  await page.evaluate(() => { location.hash = '#/admin'; }); await page.waitForTimeout(300);
  await page.click('[data-act=admin-tab][data-tab=errors]'); await page.waitForTimeout(300);
  check('errors: staff see them in Admin > Errors', (await page.locator('main .err-row').count()) >= 2);
  await page.locator('main [data-act=err-resolve]').first().click();
  await page.fill('.modal [name=note]', 'fixed in test');
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(300);
  await page.click('[data-act=err-filter][data-v=fixed]'); await page.waitForTimeout(300);
  check('errors: marking one fixed moves it to Fixed', (await page.locator('main .err-row', { hasText: 'fixed in test' }).count()) === 1);
  await page.close();
}

// ---------------------------------------------------------------- the three ways Pinoy Permit earns
// 1) Year-round care: from a branch card to an active plan, as the customer and as staff.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  check('care: "Year-round care" is in the menu', (await page.locator('.sidebar a[data-nav=care]').count()) === 1);
  await go('#/care');
  check('care: the page explains why in plain words, with the price', /We renew your permits/.test(await page.textContent('main .cx-hero')) && /Reminders tell you\. Year-round care does it\./.test(await page.textContent('main'))
    && /₱0 a month/.test(await page.textContent('main .cx-hero')));
  const ways = (await page.textContent('main .cx-ways')).replace(/\s+/g, ' ');
  check('care: two ways to pay, per renewal first (₱0, with its fees) and the All-in plan (₱1,200 / ₱250)', /Pay per renewal/.test(ways) && /₱0 a month/.test(ways) && /Mayor's Permit\s*₱6,000/.test(ways)
    && /All-in plan/.test(ways) && /₱1,200 a month per branch/.test(ways) && /₱250 a month per vehicle/.test(ways) && ways.indexOf('Pay per renewal') < ways.indexOf('All-in plan'), ways.slice(0, 200));
  check('care: it gives this business its own yearly cost both ways', /For your 1 branch and 1 vehicle: about ₱\d[\d,]* a year/.test(ways) && /₱14,500 a year, paid yearly/.test(ways), ways);
  await page.click('main .cx-faq summary:has-text("Why would anyone pay monthly?")');
  check('care: "Why would anyone pay monthly?" says tracking is free and the monthly price is optional', /isn't a fee for tracking: tracking and reminders are always free/.test(await page.textContent('main .cx-faq')));
  check('care: it shows this business its own year (renewals and hours)', /Your business, every year/.test(await page.textContent('main .cx-year')) && /renewals to do/.test(await page.textContent('main .cx-nums')));
  await page.click('main .cx-covers summary');
  check('care: "Which permits are included?" lists them, and what isn\'t', /Mayor's \/ Business Permit/.test(await page.textContent('main .cx-covers')) && /FDA/.test(await page.textContent('main .cx-covers')));
  await go('#/businesses/b1');
  const offer = page.locator('main .care-line');
  check('care: each branch card has one quiet line offering it', (await offer.count()) === 1 && /handle this branch all year/.test(await offer.textContent()) && /No monthly fee: pay per renewal/.test(await offer.textContent()));
  await offer.click(); await page.waitForTimeout(350);
  check('care: the line opens the start page with that branch ticked', (await page.evaluate(() => location.hash)).startsWith('#/care/start') && await page.isChecked('[name=pick][value="location:l1"]'));
  const total = async () => (await page.textContent('[data-care-total]')).replace(/\s+/g, ' ');
  check('care: pay per renewal is the default, at ₱0 now and every month', await page.isChecked('[name=billing][value=per_renewal]') && /To pay now, and every month\s*₱0/.test(await total())
    && /about ₱\d[\d,]* a year, paid one renewal at a time/.test(await total()) && (await page.textContent('.care-total .btn-block')).trim() === 'Start', await total());
  await page.check('[name=billing][value=monthly]'); await page.check('[name=pick][value="vehicle:v1"]'); await page.waitForTimeout(100);
  check('care: the All-in plan for a branch and a vehicle adds up', /₱1,200/.test(await total()) && /₱250/.test(await total()) && /Total per month\s*₱1,450/.test(await total()), await total());
  await page.check('[name=billing][value=yearly]'); await page.waitForTimeout(100);
  check('care: yearly shows the yearly price', /Total per year\s*₱14,500/.test(await total()) && (await page.textContent('.care-total .btn-block')).includes('₱14,500'), await total());
  await page.check('[name=billing][value=monthly]');
  await page.click('.care-total .btn-block'); await page.waitForTimeout(200);
  check('care: nothing starts without the authorization tick', /tick the box/i.test(await page.textContent('.care-form .form-error')));
  await page.check('.care-form [name=consent]');
  await page.click('.care-total .btn-block'); await page.waitForTimeout(700);
  check('care: starting goes to the plan with the first bill open to pay', (await page.evaluate(() => location.hash)) === '#/care' && /Pay bill C-/.test(await page.textContent('#modal-root')) && /₱1,450/.test(await page.textContent('#modal-root .quote-hint')));
  check('care: payment details are shown in the bill', /0917 000 0000/.test(await page.textContent('#modal-root .paywiths')));
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(200);
  check('care: "I\'ve paid" needs a reference or screenshot', /reference number or a screenshot/.test(await page.textContent('#modal-root .modal-error')));
  await page.fill('#modal-root [name=ref]', 'GC 1234 5678'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
  check('care: after paying, it says the payment is being checked', /checking your payment/i.test(await page.textContent('main')) && (await page.locator('main .care-row .chip', { hasText: 'Waiting for payment' }).count()) === 2);
  // staff confirm
  await go('#/admin');
  check('admin: Money is the first tab', (await page.locator('.tabs .tab').first().textContent()).trim() === 'Money' && (await page.locator('.tabs .tab.active').textContent()).trim() === 'Money');
  check('admin: Money says what needs you (a payment to confirm)', (await page.locator('main .todo', { hasText: 'then confirm' }).count()) === 1);
  await page.locator('main .todo', { hasText: 'then confirm' }).locator('button').click(); await page.waitForTimeout(400);
  check('admin: "Open" goes to the Care tab', (await page.locator('.tabs .tab.active').textContent()).trim() === 'Care' && (await page.locator('main .card', { hasText: 'Payments to confirm' }).count()) === 1);
  await page.click('main [data-act=care-confirm]'); await page.waitForTimeout(200);
  await page.fill('#modal-root [name=no]', 'INV-0042'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
  check('admin: confirming starts the plans', (await page.locator('main table .chip', { hasText: 'Active' }).count()) === 2);
  await go('#/care');
  check('care: the customer sees both active, with "Paid until"', (await page.locator('main .care-row .chip', { hasText: 'Active' }).count()) === 2 && /Paid until/.test(await page.textContent('main .care-row')));
  check('care: the bill shows as paid', (await page.locator('main table .chip', { hasText: 'Paid' }).count()) === 1);
  // the permit page says care covers it, and doesn't also try to sell a one-off renewal
  const mp = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'mayors_permit' && r.business_id === 'b1').id));
  await go('#/requirement/' + mp);
  check('care: a covered permit says so, with no extra sales offer', /Covered by Year-round care/.test(await page.textContent('main .care-note')) && (await page.locator('main [data-act=svc-for-req]').count()) === 0);
  await go('#/businesses/b1');
  check('care: the branch card now says it\'s covered', /Year-round care/.test(await page.textContent('main .care-line.on')) && /Active/.test(await page.textContent('main .care-line.on')));
  // cancel runs to the end of what's paid, and can be undone
  await go('#/care');
  await page.locator('main .care-row', { hasText: 'Isuzu Elf' }).locator('[data-act=care-cancel]').click(); await page.waitForTimeout(200);
  check('care: cancelling explains it runs to the end of what\'s paid', /keeps running until/.test(await page.textContent('#modal-root')));
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
  check('care: a cancelled plan shows when it ends, with "Keep it"', (await page.locator('main .care-row', { hasText: 'Isuzu Elf' }).locator('[data-act=care-resume]').count()) === 1 && /Ends/.test(await page.textContent('main .care-row:has-text("Isuzu Elf")')));
  await page.locator('main .care-row', { hasText: 'Isuzu Elf' }).locator('[data-act=care-resume]').click(); await page.waitForTimeout(400);
  check('care: "Keep it" undoes the cancellation', (await page.locator('main .care-row', { hasText: 'Isuzu Elf' }).locator('[data-act=care-cancel]').count()) === 1);
  await page.fill('main .care-pre [name=amount]', '5000'); await page.click('main .care-pre button'); await page.waitForTimeout(400);
  check('care: government-fee pre-approval saves', /up to ₱5,000/.test(await page.textContent('#toast')));
  check('care: no on-time guarantee is offered anywhere', !/guarantee/i.test(await page.textContent('main')) && (await page.locator('main [data-act=care-claim]').count()) === 0);
  check('care: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// 2) One-time jobs: rush fee shown up front, several permits at once, "set up my account" with visible access, steps.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  await go('#/services');
  check('jobs: the catalog shows Year-round care first and no old "plan" cards', (await page.locator('main .care-teaser').count()) === 1 && (await page.locator('main .svc h2', { hasText: 'Year-round care:' }).count()) === 0);
  check('jobs: "Set up my account for me" is in the catalog', (await page.locator('main .svc', { hasText: 'Set up my account for me' }).count()) === 1);
  check('jobs: rush prices are shown on the cards', /Urgent\? \+₱2,000/.test(await page.textContent('main .svc:has-text("Mayor\'s / Business Permit renewal")')));
  const many = page.locator('main [data-act=svc-bulk]');
  check('jobs: "Renew N for me" appears when several permits are due', (await many.count()) === 1 && /Renew \d+ for me/.test(await many.textContent()));
  await many.click(); await page.waitForTimeout(300);
  const ticked = await page.locator('#modal-root [name=req]:checked').count();
  check('jobs: overdue and due-within-30-days are ticked for you', ticked >= 2, String(ticked));
  check('jobs: the estimate updates as you tick', /permits · our fees from about ₱/.test(await page.textContent('#modal-root [data-bulk-sum]')));
  await page.check('#modal-root [name=rush]');
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(250);
  check('jobs: several at once still needs the authorization tick', /Please tick the box/.test(await page.textContent('#modal-root .modal-error')));
  await page.check('#modal-root [name=consent]'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(600);
  check('jobs: one request per permit, all listed', /You'll get \d+ quotes/.test(await page.textContent('#toast')) && (await page.locator('main .line', { hasText: 'Preparing your quote' }).count()) >= ticked);
  // staff quote one of them with the rush fee
  await go('#/admin');
  await page.click('[data-act=admin-tab][data-tab=orders]'); await page.waitForTimeout(300);
  check('admin: several-at-once requests are labelled', (await page.locator('main .line', { hasText: 'several at once' }).count()) >= 2);
  await page.locator('main .line', { hasText: "Renewal: Mayor's" }).first().click(); await page.waitForTimeout(300);
  check('admin: urgent requests get a rush fee field, filled with the catalog rush fee', (await page.inputValue('.admin-quote [name=rush]')) === '2000');
  await page.fill('.admin-quote [name=fee]', '2500'); await page.fill('.admin-quote [name=gov]', '4200'); await page.click('.admin-quote button'); await page.waitForTimeout(400);
  await go('#/services');
  await page.locator('main .line', { hasText: "Mayor's" }).first().click(); await page.waitForTimeout(700); // the order page loads it fresh
  check('jobs: the quote shows the rush fee as its own line, and the total adds up', /Rush fee/.test(await page.textContent('.card.quote')) && (await page.textContent('.qline.total')).includes('8,700'));
  // set up my account for me
  await go('#/services');
  await page.locator('main .svc', { hasText: 'Set up my account for me' }).locator('[data-act=svc-request]').click(); await page.waitForTimeout(250);
  check('jobs: the set-up request says Pinoy Permit joins the workspace until done', /joins your workspace as a team member until the job is done/.test(await page.textContent('#modal-root')));
  await page.check('#modal-root [name=consent]'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(600);
  const setupHash = await page.evaluate(() => location.hash);
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=orders]'); await page.waitForTimeout(300);
  await page.locator('main .line', { hasText: 'Set up my account for me' }).click(); await page.waitForTimeout(300);
  check('admin: the set-up job shows the "join their workspace" card, waiting for consent', /haven't agreed to access yet/.test(await page.textContent('main')));
  await page.fill('.admin-quote [name=fee]', '2000'); await page.click('.admin-quote button'); await page.waitForTimeout(400);
  await go(setupHash);
  await page.click('[data-act=quote-accept]'); await page.waitForTimeout(200);
  check('jobs: accepting a set-up quote needs the access tick first', /Tick the box to let Pinoy Permit join/.test(await page.textContent('#toast')) && (await page.locator('#modal-root .modal').count()) === 0);
  await page.check('[data-access-ok]'); await page.click('[data-act=quote-accept]'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
  await page.fill('.pay-form [name=ref]', 'GC-9'); await page.click('.pay-form button[type=submit]'); await page.waitForTimeout(400);
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=orders]'); await page.waitForTimeout(300);
  await page.locator('main .line', { hasText: 'Set up my account for me' }).click(); await page.waitForTimeout(300);
  await page.click('[data-act=admin-pay][data-ok="1"]'); await page.waitForTimeout(400);
  await page.click('[data-act=admin-join]'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
  await page.check('.admin-steps [name=done][value="2"]'); await page.click('.admin-steps button'); await page.waitForTimeout(400);
  await go('#/team');
  check('jobs: the team page shows Pinoy Permit with why and until when', (await page.locator('main .staff-tag').count()) === 1 && /Ends automatically when that job is done/.test(await page.textContent('main')));
  await go(setupHash);
  check('jobs: the order shows the access and the steps done', /Pinoy Permit has access to/.test(await page.textContent('main')) && /2 of 5 done/.test(await page.textContent('main .job-steps').then(() => page.textContent('main'))) && (await page.locator('main .job-steps li.done').count()) === 2);
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=orders]'); await page.waitForTimeout(300);
  await page.locator('main .line', { hasText: 'Set up my account for me' }).click(); await page.waitForTimeout(300);
  await page.selectOption('.admin-update [name=status]', 'completed'); await page.click('.admin-update button'); await page.waitForTimeout(400);
  await go('#/team');
  check('jobs: finishing the job ends Pinoy Permit\'s access', (await page.locator('main .staff-tag').count()) === 0);
  check('jobs: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// 3) Fees from firms, inside the app: one quiet, labelled line on a checklist step; can be switched off.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  const fsic = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'fsic' && r.business_id === 'b1').id));
  await go('#/requirement/' + fsic);
  if (!(await page.locator('.checklist[open]').count())) { await page.click('.checklist summary'); await page.waitForTimeout(250); }
  const line = page.locator('.ck-list li', { hasText: 'Fire extinguishers' }).locator('.ck-partner');
  check('partners: one line on the matching step, labelled "Partner"', (await page.locator('.ck-partner').count()) === 1 && (await line.count()) === 1 && /Partner/.test(await line.locator('.ck-partner-tag').textContent()));
  check('partners: it is quiet (small grey text, no colors or images)', await line.evaluate((e) => parseFloat(getComputedStyle(e).fontSize) <= 14 && !e.querySelector('img')));
  check('partners: our own walk-through is offered on the inspection step', /Book a pre-inspection walk-through/.test(await page.textContent('.ck-list li:has-text("Have someone at the site") .ck-offer')));
  await line.locator('[data-act=placement-why]').click(); await page.waitForTimeout(200);
  check('partners: "Why this?" says the firm pays and it doesn\'t change their price', /pays Pinoy Permit/.test(await page.textContent('#modal-root')) && /never changes the firm's price/.test(await page.textContent('#modal-root')));
  await page.click('#modal-root [data-modal-close]');
  await line.locator('[data-act=placement-quote]').click(); await page.waitForTimeout(300);
  check('partners: "Request a quote" asks first and says what is shared', /Request a quote from Metro Fire Safety/.test(await page.textContent('#modal-root')) && /nothing else/.test(await page.textContent('#modal-root')));
  await page.fill('#modal-root [name=contact_value]', '0917 123 4567'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
  check('partners: the request is sent', /Sent\./.test(await page.textContent('#toast')));
  const stats = await page.evaluate(async () => (await import('/__mock/mock-data.js')).adminPlacementStats());
  check('partners: the line counted one view, one click and one request', stats[0]?.views === 1 && stats[0]?.clicks === 1 && stats[0]?.leads === 1, JSON.stringify(stats));
  await go('#/settings');
  await page.locator('[data-profile-pref=show_partner_offers]').evaluate((e) => e.click()); await page.waitForTimeout(300);
  await go('#/requirement/' + fsic);
  if (!(await page.locator('.checklist[open]').count())) { await page.click('.checklist summary'); await page.waitForTimeout(250); }
  check('partners: switched off in Settings, the line is gone', (await page.locator('.ck-partner').count()) === 0);
  check('partners: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// 4) Firms apply to be listed (no account).
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { globalThis.PP_LOGGED_OUT = true; });
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('.landing');
  check('apply: the public page has a quiet "For service providers" link', (await page.locator('.lp-foot a[href="#/list-your-firm"]').count()) === 1);
  await page.click('.lp-foot a[href="#/list-your-firm"]'); await page.waitForTimeout(400);
  check('apply: the page says how it works and what it costs them (prepaid, bad leads credited back)', /Prepaid, so no bills/.test(await page.textContent('main')) && /Bad lead\? Report it/.test(await page.textContent('main')) && /flat monthly listing/.test(await page.textContent('main')));
  await page.click('#apply-form button'); await page.waitForTimeout(200);
  check('apply: empty form says what is missing', /firm's name/.test(await page.textContent('#apply-form .form-error')));
  await page.fill('#apply-form [name=name]', 'Makati Fire Safety'); await page.selectOption('#apply-form [name=category]', 'fire_safety');
  await page.fill('#apply-form [name=contact_name]', 'Ana Cruz'); await page.fill('#apply-form [name=email]', 'ana@makatifire.ph');
  await page.fill('#apply-form [name=website]', 'makatifire.ph'); await page.click('#apply-form button'); await page.waitForTimeout(200);
  check('apply: a website without https:// is caught', /https:\/\//.test(await page.textContent('#apply-form .form-error')));
  await page.fill('#apply-form [name=website]', ''); await page.click('#apply-form button'); await page.waitForTimeout(200);
  check('apply: the firm must confirm it is registered and licensed (Pinoy Permit doesn\'t check)', /confirm your business is registered and licensed/.test(await page.textContent('#apply-form .form-error'))
    && /Pinoy Permit doesn't check this/.test(await page.textContent('#apply-form .attest')));
  await page.check('#apply-form [name=attested]'); await page.click('#apply-form button'); await page.waitForTimeout(400);
  check('apply: sent, with a clear next step', /Thanks, we got it/.test(await page.textContent('main')) && /3 business days/.test(await page.textContent('main')));
  check('apply: no sideways scroll on a phone', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  check('apply: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// 5) Staff: Money (five views), Partner billing, Professionals, a team plan payment. Uses the demo's year of history.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(() => { globalThis.PP_DEMO = true; });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };
  const view = async (v) => { await page.click(`[data-act=money-view][data-v=${v}]`); await page.waitForTimeout(350); };
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  await go('#/admin');
  check('money: Home shows the four big numbers in plain words', (await page.locator('main .mh-card').count()) === 4 && /You earned this month/.test(await page.textContent('main'))
    && /Owed to you/.test(await page.textContent('main .mh-cards')) && /Comes in every month/.test(await page.textContent('main')) && /Not your money/.test(await page.textContent('main')));
  check('money: Home lists what needs doing as sentences, with counts', (await page.locator('main .todo').count()) >= 3 && /want(s)? to be listed on Pinoy Permit/.test(await page.textContent('main')));
  check('money: Home shows only the first 5 receipt numbers to add, with "Show all"', (await page.locator('#money-invoices tbody tr').count()) <= 5);
  if (await page.locator('[data-act=money-all-receipts]').count()) { await page.click('[data-act=money-all-receipts]'); await page.waitForTimeout(400); }
  const missBefore = await page.locator('#money-invoices tbody tr').count();
  check('money: payments without a BIR receipt number are listed', missBefore >= 1, String(missBefore));
  await page.fill('#money-invoices tbody tr:first-child [name=no]', 'INV-9001'); await page.click('#money-invoices tbody tr:first-child button'); await page.waitForTimeout(500);
  check('money: typing the receipt number takes it off the list', (await page.locator('#money-invoices tbody tr').count()) === missBefore - 1);
  await view('earnings');
  check('money: Earnings shows the month, the goal and where it came from', /You earned in/.test(await page.textContent('main .money-hero')) && (await page.locator('main .goal-bar').count()) === 1 && (await page.locator('main .money-stat').count()) === 5);
  check('money: Earnings draws 12 months, stacked, with a legend and the numbers (load top-ups included)', (await page.locator('svg.trend .col').count()) === 12 && (await page.locator('main .legend > span').count()) === 5 && (await page.locator('main .num-table tbody tr').count()) === 12);
  const tall = await page.evaluate(() => Math.max(...[...document.querySelectorAll('svg.trend .col')].map((g) => g.getBBox().height)));
  check('money: the year has real columns (not empty)', tall > 40, String(tall));
  await page.focus('svg.trend .col:last-of-type'); await page.waitForTimeout(150);
  check('money: a month explains itself on focus (keyboard) or hover', !(await page.locator('.chart-tip').isHidden()) && /One-time jobs/.test(await page.textContent('.chart-tip')));
  await view('owed');
  check('money: Owed to you lists who owes what, and for how long', (await page.locator('main .lane').count()) === 5 && /People owe you/.test(await page.textContent('main')) && (await page.locator('main .wait').count()) >= 1);
  await view('payments');
  const rows = await page.locator('main table.ledger tbody tr').count();
  check('money: All payments lists every line', rows > 50, String(rows));
  await page.selectOption('main [data-ledger=stream]', 'care'); await page.waitForTimeout(400);
  check('money: All payments filters by kind of work', (await page.locator('main table.ledger tbody tr').count()) < rows && !(await page.textContent('main table.ledger tbody')).includes('One-time jobs'));
  await page.selectOption('main [data-ledger=state]', 'collected'); await page.waitForTimeout(400);
  check('money: "Show: Money you received" shows only received payments', (await page.locator('main table.ledger tbody tr').count()) >= 1 && (await page.locator('main table.ledger tbody tr:not(.collected)').count()) === 0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=ledger-csv]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check('money: the download has the receipt number column for the accountant', /BIR invoice no\./.test(csv.split('\n')[0]) && csv.split('\n').length > 2);
  // Partner billing: make and settle a statement
  await page.click('[data-act=admin-tab][data-tab=billing]'); await page.waitForTimeout(400);
  check('billing: each firm\'s unbilled total is shown', /Not billed yet/.test(await page.textContent('main')) && (await page.locator('main [data-act=stmt-new]').count()) >= 1);
  await page.locator('main [data-act=stmt-new]').first().click(); await page.waitForTimeout(250);
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
  const sent = page.locator('main .row', { has: page.locator('[data-act=stmt-paid]') }).first();
  check('billing: the statement is made and listed as sent', (await sent.count()) === 1);
  await sent.locator('[data-act=stmt-paid]').click(); await page.waitForTimeout(250);
  await page.fill('#modal-root [name=method]', 'BPI'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
  check('billing: marking it paid', /Marked paid/.test(await page.textContent('#toast')));
  // Professionals: application, fee model, checklist line stats
  await page.click('[data-act=admin-tab][data-tab=partners]'); await page.waitForTimeout(400);
  check('partners admin: one short row per firm, no forms on the page', (await page.locator('main [data-pro-row]').count()) >= 3 && (await page.locator('main form').count()) === 0);
  await page.locator('main [data-pro-row]', { hasText: 'Metro Fire Safety' }).locator('[data-act=pro-details]').click(); await page.waitForTimeout(300);
  check('partners admin: checklist lines show honest counts', /41 people saw it/.test(await page.textContent('#modal-root')) && /6 opened it/.test(await page.textContent('#modal-root')));
  await page.click('#modal-root [data-modal-close]');
  await page.locator('main [data-act=app-list]').click(); await page.waitForTimeout(400);
  const cebu = page.locator('main [data-pro-row]', { hasText: 'Cebu Pest Busters' });
  check('partners admin: an application becomes a hidden draft listing', (await cebu.locator('.chip', { hasText: 'Hidden' }).count()) === 1);
  await page.fill('main [data-pro-search]', 'cebu pest'); await page.waitForTimeout(100);
  check('partners admin: search finds a firm by name', (await page.locator('main [data-pro-row]:not([hidden])').count()) === 1);
  await page.fill('main [data-pro-search]', ''); await page.click('main [data-pro-filter=hidden]'); await page.waitForTimeout(100);
  check('partners admin: "Hidden" shows only hidden firms', (await page.locator('main [data-pro-row]:not([hidden])').count()) === 1 && await cebu.isVisible());
  await page.click('main [data-pro-filter=all]');
  await cebu.locator('[data-act=pro-edit]').click(); await page.waitForSelector('#modal-root [name=fee_model]');
  const form = page.locator('#modal-root form');
  check('partners admin: one email for quote requests and statements; the extras are tucked under More', (await form.locator('[name=contact_email]').isVisible()) && !(await form.locator('[name=billing_email]').isVisible()) && !(await form.locator('[name=license]').isVisible()));
  check('partners admin: permits are picked by name, not typed as codes', (await form.locator('[name=type_codes]').count()) === 0 && (await form.locator('[name=types]').count()) > 10);
  await form.locator('[name=fee_model]').selectOption('monthly'); await page.waitForTimeout(100);
  check('partners admin: choosing "Flat monthly listing" shows only that fee box', await form.locator('[data-fee=monthly]').isVisible() && await form.locator('[data-fee=per_lead]').isHidden());
  await form.locator('[name=category]').selectOption('insurance'); await page.waitForTimeout(100);
  check('partners admin: insurers get the Insurance Code note', await form.locator('[data-ins-note]').isVisible());
  await page.fill('#modal-root [name=monthly_fee_php]', '1500'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
  check('partners admin: saving from the pop-up updates the row', /₱1,500 a month/.test(await cebu.textContent()), (await cebu.textContent()).replace(/\s+/g, ' ').slice(0, 120));
  // a team plan paid by GCash
  await page.click('[data-act=admin-tab][data-tab=orgs]'); await page.waitForTimeout(400);
  await page.locator('main [data-act=plan-pay]').first().click(); await page.waitForTimeout(250);
  check('plans: the payment form fills the amount from the plan', Number(await page.inputValue('#modal-root [name=amount]')) > 0);
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
  check('plans: the payment is recorded', /Payment recorded/.test(await page.textContent('#toast')));
  await page.click('[data-act=admin-tab][data-tab=care]'); await page.waitForTimeout(400);
  check('care admin: lists plans from every workspace and the prices', (await page.locator('main table tbody tr').count()) >= 6 && (await page.locator('main form.admin-tier').count()) === 4);
  check('money/admin: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// 6) Phones: the new pages fit a small screen.
{
  const page = await browser.newPage({ viewport: { width: 360, height: 760 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { globalThis.PP_DEMO = true; });
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  const bad = [];
  for (const h of ['#/care', '#/care/start', '#/services', '#/services/orders/ord2', '#/businesses/b2', '#/admin']) {
    await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(450);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 1) bad.push(`${h} ${o}px`);
  }
  for (const v of ['earnings', 'owed', 'payments']) {
    await page.click(`[data-act=money-view][data-v=${v}]`); await page.waitForTimeout(350);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 1) bad.push(`money ${v} ${o}px`);
  }
  check('phone: the new pages have no sideways scroll at 360px', bad.length === 0, bad.join(', '));
  await page.evaluate(() => { location.hash = '#/care'; }); await page.waitForTimeout(450);
  check('care: a license outside the plan is listed as "Not in Care, quoted per job"',
    /Not in Care, quoted per job: FDA License to Operate/.test(await page.textContent('main .care-row:has-text("Visayas Sari-Sari Distribution Co. · Main branch")')));
  await page.evaluate(() => { location.hash = '#/care/start'; }); await page.waitForTimeout(450);
  check('care start: a branch with extra licenses says how many are quoted separately', /1 quoted separately/.test(await page.textContent('main .care-pick:has-text("Visayas Sari-Sari Distribution Co. · Main branch")')));
  await page.evaluate(() => { location.hash = '#/care'; }); await page.waitForTimeout(450);
  const hilux = page.locator('main .care-row', { hasText: 'Toyota Hilux' });
  check('care: a pay-per-renewal vehicle says "no monthly fee" and can be turned off', /no monthly fee/.test(await hilux.textContent()) && (await hilux.locator('[data-act=care-cancel]').textContent()).trim() === 'Turn off');
  await hilux.locator('[data-act=care-cancel]').click(); await page.waitForTimeout(250);
  check('care: turning it off stops today and keeps reminders', /stop starting renewals for it today/.test(await page.textContent('#modal-root')) && /Reminders keep coming, for free/.test(await page.textContent('#modal-root')));
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(450);
  check('care: turned off, it\'s gone from "What we handle"', (await page.locator('main .care-row:not(details .care-row)', { hasText: 'Toyota Hilux' }).count()) === 0);
  await page.evaluate(() => { location.hash = '#/care/start?veh=v2'; }); await page.waitForTimeout(450);
  await page.check('.care-form [name=consent]'); await page.click('.care-total .btn-block'); await page.waitForTimeout(700);
  check('care: pay per renewal starts at once, with no bill to pay', (await page.evaluate(() => location.hash)) === '#/care' && (await page.locator('#modal-root .quote-hint').count()) === 0
    && /We'll message you when we start a renewal/.test(await page.textContent('#toast')) && (await page.locator('main .care-row:not(details .care-row)', { hasText: 'Toyota Hilux' }).locator('.chip', { hasText: 'Active' }).count()) === 1);
  await page.evaluate(() => { location.hash = '#/services/orders/ord2'; }); await page.waitForTimeout(450);
  check('care renewal order: says the plan started it and the fee is covered', /covered by your care plan/.test(await page.textContent('main .card.quote')) && /Year-round care/.test(await page.textContent('main .page-head')));
  check('phone: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// A database without the newer changes: none of the new features show, and nothing breaks.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript(() => { globalThis.PP_FEATURES = 'none'; globalThis.PP_TEAM = true; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  const seen = [];
  const mp = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'mayors_permit').id));
  for (const h of ['#/compliance', '#/businesses/b1', '#/team', '#/settings', '#/settings/workspace', '#/admin', '#/requirement/' + mp, '#/']) {
    await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250);
    if (await page.locator('main .who, main .handled, [data-act=bulk-toggle], #esc-form, [data-tab=errors], [data-tab=orders], .checklist, .offer-inline, .lib-more, .focus-alt, .sidebar [data-nav=services], .sidebar [data-nav=filings], [data-filings-brief]:not([hidden]), #staff-access, #sms, #mfa-section, [data-act-change=require-mfa], .sidebar [data-nav=care], [data-tab=money], [data-tab=care], [data-tab=billing], .care-line, .care-note, .care-teaser, .nudge, [data-act=svc-bulk], .ck-partner, .ck-offer, [data-profile-pref], a[href="#/list-your-firm"]').count()) seen.push(h);
  }
  check('features off: nothing new shows before the database is updated', seen.length === 0, seen.join(','));
  check('features off: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// Getting paid for quote requests: prepaid credit, reports from firms, "Did you hire them?".
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript(() => { globalThis.PP_DEMO = true; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(450); };
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  await go('#/pros');
  check('leads: no firm website in the directory (requests go through Pinoy Permit)', (await page.locator('main .partner a[href^="http"]').count()) === 0);
  check('leads: a firm out of credit isn\'t listed', !(await page.textContent('main')).includes('Sample Permit Desk') && (await page.textContent('main')).includes('Sample Liaison Services'));
  await page.click('[data-act=partner-intro][data-id=p1]');
  await page.selectOption('.modal [name=contact_method]', 'email');
  await page.fill('.modal [name=contact_value]', 'sadie@test.ph');
  await page.click('.modal button[type=submit]'); await page.waitForTimeout(500);
  const ask = page.locator('main .hired-ask').first();
  check('leads: each request asks "Did you hire them?"', (await ask.count()) === 1 && /Did you hire them\?/.test(await ask.textContent()));
  await ask.locator('[data-hired="1"]').click(); await page.waitForTimeout(500);
  check('leads: answering yes marks it Hired', (await page.locator('main .chip', { hasText: 'Hired' }).count()) >= 1 && /Thanks/.test(await page.textContent('#toast')));
  await go('#/admin');
  await page.click('[data-act=admin-tab][data-tab=partners]'); await page.waitForTimeout(500);
  const p1 = page.locator('main [data-pro-row]', { hasText: 'Sample Liaison Services' }).first();
  check('leads admin: credit and requests left are shown', /₱[\d,]+\s*\d+ requests? left at ₱500/.test(await p1.textContent()), (await p1.textContent()).replace(/\s+/g, ' ').slice(0, 200));
  check('leads admin: how often customers hired the firm', /Last 90 days: \d+ quote requests · \d+ hired/.test(await p1.textContent()));
  await p1.locator('[data-act=pro-details]').click(); await page.waitForTimeout(300);
  await page.locator('#modal-root .credit-hist summary').click(); await page.waitForTimeout(150);
  check('leads admin: the credit history lists top-ups and requests with the balance', (await page.locator('#modal-root .credit-hist tbody tr').count()) >= 8 && /Paid in/.test(await page.locator('#modal-root .credit-hist').textContent()));
  await page.click('#modal-root [data-modal-close]');
  const desk = page.locator('main [data-pro-row]', { hasText: 'Sample Permit Desk' }).first();
  check('leads admin: a firm out of credit shows "Paused: no credit"', (await desk.locator('.chip', { hasText: 'Paused: no credit' }).count()) === 1);
  await desk.locator('[data-act=pro-edit]').click(); await page.waitForSelector('#modal-root [name=fee_model]');
  check('leads admin: per-sale fees are gone', (await page.locator('#modal-root [name=fee_model] option[value=per_sale_flat]').count()) === 0
    && (await page.locator('#modal-root [name=fee_model] option[value=per_lead]').first().textContent()).includes('prepaid credit'));
  await page.click('#modal-root [data-modal-close]');
  await desk.locator('[data-act=credit-add]').click(); await page.waitForTimeout(250);
  await page.fill('#modal-root [name=amount]', '2500'); await page.fill('#modal-root [name=method]', 'GCash'); await page.fill('#modal-root [name=ref]', '1009 22');
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
  check('leads admin: adding credit puts the firm back live', /Added/.test(await page.textContent('#toast'))
    && (await page.locator('main [data-pro-row]', { hasText: 'Sample Permit Desk' }).first().locator('.chip', { hasText: 'Live' }).count()) === 1);
  await page.click('[data-act=admin-tab][data-tab=billing]'); await page.waitForTimeout(500);
  check('leads admin: the reported lead waits with its reason', /Reported leads/.test(await page.textContent('main')) && /A duplicate/.test(await page.textContent('main')) && (await page.locator('main [data-act=dispute-accept]').count()) === 1);
  await page.click('main [data-act=dispute-accept]'); await page.waitForTimeout(250);
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
  check('leads admin: accepting puts the fee back on the firm\'s credit', /back on their credit/.test(await page.textContent('#toast')) && (await page.locator('main .chip', { hasText: 'Accepted' }).count()) === 1);
  check('leads: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
  // The firm's page, from the link in the lead email: no account needed.
  const out = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await out.addInitScript(() => { globalThis.PP_DEMO = true; globalThis.PP_LOGGED_OUT = true; });
  const oerrs = [];
  out.on('pageerror', (e) => oerrs.push(e.message));
  await out.goto('http://localhost:4173/'); await out.waitForSelector('.landing h1');
  const token = await out.evaluate(async () => (await import('/__mock/mock-data.js')).demoLeadToken());
  await out.evaluate((t) => { location.hash = '#/lead/' + t; }, token); await out.waitForTimeout(600);
  check('firm page: opens from the email link without an account', /Quote request from Isla Water Station/.test(await out.textContent('h1')) && /₱500 from your Pinoy Permit credit/.test(await out.textContent('.lead-page')));
  await out.click('#lead-report button'); await out.waitForTimeout(200);
  check('firm page: a report needs a reason', /Choose a reason/.test(await out.textContent('#lead-report .form-error')));
  await out.check('#lead-report [name=reason][value=unreachable]');
  await out.fill('#lead-report [name=note]', 'Called 3 times, no answer');
  await out.click('#lead-report button'); await out.waitForTimeout(600);
  check('firm page: the report is sent, and the page says what happens next', /You reported this request/.test(await out.textContent('.lead-page')) && /couldn't reach them/i.test(await out.textContent('.lead-page')));
  const o = await out.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('firm page: fits a phone', o <= 1, `${o}px`);
  await out.evaluate(() => { location.hash = '#/lead/not-a-real-link'; }); await out.waitForTimeout(500);
  check('firm page: a broken link says so', /isn't valid/.test(await out.textContent('.lead-page')));
  check('firm page: no JavaScript errors', oerrs.length === 0, oerrs.slice(0, 3).join(' | '));
  await out.close();
}

// Online only, as on the live site: nothing that needs someone at city hall, the LTO or an inspection.
{
  inPerson = false;
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript(() => { globalThis.PP_DEMO = true; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('main h1');
  check('online only: no Year-round care in the menu', (await page.locator('.sidebar a[data-nav=care]').count()) === 0 && (await page.locator('.sidebar a[data-nav=services]').count()) === 1);
  check('online only: the dashboard offers no in-person renewals or care', (await page.locator('main [data-act=svc-for-req], main .nudge').count()) === 0);
  await go('#/care');
  check('online only: old Year-round care links go to Done for you', (await page.evaluate(() => location.hash)) === '#/services');
  const names = await page.locator('main .svc-grid .svc h2').allTextContents();
  check('online only: Done for you lists only online services', names.length >= 4 && names.some((x) => /Set up my account/.test(x)) && names.some((x) => /DTI business name/.test(x))
    && !names.some((x) => /Mayor|Barangay|Fire Safety|Sanitary|LTO|walk-through|New business|branch opening|closure|replacement/i.test(x)), names.join(' | '));
  check('online only: no care teaser and no "Renew several"', (await page.locator('main .care-teaser, main [data-act=svc-bulk]').count()) === 0
    && /Online paperwork, done for you/.test(await page.textContent('main .page-head')));
  check('online only: the demo\'s sample order is the online set-up job', (await page.locator('main .line', { hasText: 'Set up my account for me' }).count()) >= 1);
  await go('#/services/orders/ord1');
  check('online only: an account set-up (no office involved) offers no authorization letter', /Set up my account/.test(await page.textContent('main')) && (await page.locator('[data-act=auth-letter]').count()) === 0);
  await go('#/services?service=renew_mayors_permit');
  check('online only: an in-person service can\'t be ordered by link', /not available/.test(await page.textContent('#toast')) && (await page.locator('#modal-root .modal').count()) === 0);
  await go('#/compliance');
  check('online only: no "Have Pinoy Permit renew several" on Compliance', (await page.locator('main [data-act=svc-bulk]').count()) === 0);
  await go('#/businesses/b2');
  check('online only: branch cards don\'t offer Year-round care', (await page.locator('main .care-line').count()) === 0);
  const mp = await page.evaluate(async () => (await import('/__mock/mock-data.js')).loadOrgData().then((d) => d.reqs.find((r) => r.type_code === 'mayors_permit' && r.business_id === 'b2').id));
  await go('#/requirement/' + mp);
  check('online only: a Mayor\'s Permit page offers no renewal by Pinoy Permit', (await page.locator('main [data-act=svc-for-req], main .care-note, main .ck-offer').count()) === 0);
  await go('#/admin');
  check('online only: staff have no Care tab', (await page.locator('[data-act=admin-tab][data-tab=care]').count()) === 0);
  await page.click('[data-act=money-view][data-v=earnings]'); await page.waitForTimeout(350);
  check('online only: Money doesn\'t show a care stream', !/Monthly care plans/.test(await page.textContent('main')) && /Subscriptions/.test(await page.textContent('main')));
  await page.click('[data-act=admin-tab][data-tab=services]'); await page.waitForTimeout(400);
  check('online only: staff see which services are hidden', (await page.locator('main .chip', { hasText: 'In person: hidden' }).count()) >= 10);
  check('online only: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
  const out = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await out.addInitScript(() => { globalThis.PP_LOGGED_OUT = true; });
  await out.goto('http://localhost:4173/'); await out.waitForSelector('.landing h1');
  check('online only: the sign-in page doesn\'t sell Year-round care', !/Or let us do it all|Year-round care/.test(await out.textContent('.landing')));
  await out.close();
  inPerson = true;
}

// The website as customers see it (online only): "Track and manage every permit. Easily.", everything on one screen, the
// worries it takes away, the 5-step tour and the free plan as a receipt; prices on their own page.
{
  inPerson = false;
  const S2 = ['errors', 'assign', 'library2', 'services', 'filings', 'sms', 'mfa', 'revenue'];
  const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  for (const [label, init, vp] of [['all', {}, { width: 1280, height: 860 }], ['live', { PP_FEATURES: S2 }, { width: 390, height: 844 }], ['tiny', {}, { width: 320, height: 640 }]]) {
    const p = await browser.newPage({ viewport: vp });
    await p.addInitScript((i) => { Object.assign(globalThis, { PP_LOGGED_OUT: true }, i); }, init);
    const e = [];
    p.on('pageerror', (x) => e.push(x.message));
    await p.goto('http://localhost:4173/'); await p.waitForSelector('.lp-home h1');
    const text = await p.textContent('.landing');
    check(`website ${label}: the home page leads with "Track and manage every permit. Easily." under "Permits on autopilot"`, /^Track and manage every permit\. Easily\.$/.test(await p.textContent('.lp-home h1'))
      && (await p.textContent('.lp-hero2 .lp-tag')) === 'Permits on autopilot' && /^Add your permits once\./.test(await p.textContent('.lp-hero2 .lp-lead')));
    check(`website ${label}: the logo is square and sharp, and big enough to read`, await p.evaluate(async () => {
      const i = document.querySelector('.lp-top .brand img'), r = i.getBoundingClientRect();
      await i.decode();
      return i.naturalWidth >= 512 && i.naturalWidth === i.naturalHeight && Math.abs(r.width - r.height) < 1 && r.height >= (innerWidth > 640 ? 48 : 30);
    }));
    check(`website ${label}: the receipt uses the site's own type (no typewriter font) and the two-color name`, await p.evaluate(() => {
      const f = (q) => getComputedStyle(document.querySelector(q)).fontFamily;
      return ['.lp-rc-plan', '.lp-rc-every', '.lp-rc-inc', '.lp-rc-amt'].every((q) => !/Mono|monospace/.test(f(q)))
        && document.querySelector('.lp-rc-name .w1').textContent === 'Pinoy' && getComputedStyle(document.querySelector('.lp-rc-name .w1')).color !== getComputedStyle(document.querySelector('.lp-rc-name .w2')).color;
    }));
    check(`website ${label}: the name is Pinoy Permit everywhere on the page and in the tab`, !/PermitPal|Permit ?Pal\b/.test(text) && !/PermitPal/.test(await p.title())
      && /Pinoy Permit/.test(await p.title()) && (await p.textContent('.lp-top .brand')).trim() === 'Pinoy Permit');
    check(`website ${label}: the example phone shows Sadie's Kitchen`, /Good morning, Sadie/.test(await p.textContent('.lp-screen')) && (await p.textContent('.lp-biz')) === "Sadie's Kitchen");
    check(`website ${label}: "One screen." sits on a line of its own`, await p.evaluate(() => {
      const [a, b] = document.querySelectorAll('#for-you-h .lp-line');
      return b.textContent === 'One screen.' && b.getClientRects().length === 1 && b.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 2;
    }));
    check(`website ${label}: 8 worries taken away, and 8 lines on the free-plan receipt at ₱0.00`, (await p.locator('.lp-worry').count()) === 8
      && (await p.locator('.lp-rc-lines li').count()) === 8 && /Total each month\s*₱0\.00/.test(await p.textContent('.lp-receipt')));
    check(`website ${label}: no prices on the home page`, (await p.locator('[data-plan-card], .bill-toggle, #pricing').count()) === 0);
    check(`website ${label}: nothing removed, and nothing Pinoy Permit doesn't do`, !/Head office|Year-round care|licensed firm|we verify|verified by Pinoy Permit|vetted|legal/i.test(text));
    check(`website ${label}: Plus mentioned only once its database part is on`, /Plus, more staff/.test(text) === (label !== 'live'));
    check(`website ${label}: the tour starts at step 1, Add`, (await p.getAttribute('.lp-dot[aria-current=step]', 'data-step')) === '1' && /Add permits your way/.test(await p.textContent('.lp-stage')));
    let worst = await over(p), screens = new Set([await p.getAttribute('.lp-stage .lp-scr', 'aria-label')]);
    for (const [k, title] of [[2, "Reminded before it's late"], [3, 'Know exactly what to bring'], [4, "Show you're legit"], [5, label === 'live' ? 'Share the load' : 'Your team does the chasing']]) {
      await p.click('.lp-btn-step'); await p.waitForTimeout(120);
      const ok = (await p.getAttribute('.lp-dot[aria-current=step]', 'data-step')) === String(k) && (await p.textContent('.lp-stage h3')).includes(title);
      check(`website ${label}: "Next" moves the tour to step ${k}`, ok, await p.textContent('.lp-stage h3'));
      check(`website ${label}: step ${k}'s earlier steps show as done`, (await p.locator('.lp-dot.on').count()) === k && (await p.locator('.lp-seg.on').count()) === k - 1);
      screens.add(await p.getAttribute('.lp-stage .lp-scr', 'aria-label'));
      worst = Math.max(worst, await over(p));
    }
    check(`website ${label}: the phone shows a different screen at each step`, screens.size === 5);
    await p.click('.lp-btn-step'); await p.waitForTimeout(120);
    check(`website ${label}: "Start again" goes back to step 1`, (await p.getAttribute('.lp-dot[aria-current=step]', 'data-step')) === '1');
    await p.click('.lp-dot[data-step="4"]'); await p.waitForTimeout(120);
    check(`website ${label}: tapping a step jumps to it`, (await p.getAttribute('.lp-dot[aria-current=step]', 'data-step')) === '4');
    await p.click('.lp-stage .btn-ghost'); await p.waitForTimeout(120);
    check(`website ${label}: "Back" goes one step back`, (await p.getAttribute('.lp-dot[aria-current=step]', 'data-step')) === '3');
    check(`website ${label}: no sideways scroll at any tour step`, worst <= 1, `${worst}px`);
    if (label === 'all') {
      const before = await p.evaluate(() => location.hash);
      await p.click('.lp-nav[data-scroll-to=tour]'); await p.waitForTimeout(800);
      check('website: "How it works" scrolls to the tour and keeps the address', (await p.evaluate(() => location.hash)) === before
        && (await p.evaluate(() => document.getElementById('tour').getBoundingClientRect().top)) < 200);
      await p.click('.lp-nav[href="#/pricing"]'); await p.waitForTimeout(500);
      check('website: "Prices" opens the prices page at the top', /Simple prices/.test(await p.textContent('main h1')) && (await p.evaluate(() => scrollY)) === 0);
    } else await p.evaluate(() => { location.hash = '#/pricing'; });
    await p.waitForSelector('#pricing [data-plan-card] .pp-amount');
    check(`website ${label}: the prices page lists Free and every team plan on sale`, (await p.locator('#pricing .pp-plan.pp-free').count()) === 1
      && (await p.locator('#pricing [data-plan-card]').count()) === (label === 'live' ? 3 : 4)); // Small property comes with database file 8
    check(`website ${label}: Plus shown on the prices page only once its database part is on`, (await p.locator('.lp-show').count()) === (label === 'live' ? 0 : 1));
    check(`website ${label}: what load buys, with prices, only once its database part is on`, (await p.locator('.lp-load-card').count()) === (label === 'live' ? 0 : 5));
    check(`website ${label}: prices page: no sideways scroll`, (await over(p)) <= 1, `${await over(p)}px`);
    await p.click('.lp-top .brand'); await p.waitForSelector('.lp-home h1');
    check(`website ${label}: the logo goes back home`, /Track and manage every permit/.test(await p.textContent('main h1')));
    check(`website ${label}: no JavaScript errors`, e.length === 0, e.slice(0, 3).join(' | '));
    await p.close();
  }
  // Signed in, a prices link from the website lands on Settings > Plan.
  const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await p.goto('http://localhost:4173/#/pricing'); await p.waitForTimeout(800);
  check('website: signed in, the prices page goes to Settings > Plan', (await p.evaluate(() => location.hash)) === '#/settings/billing');
  await p.close();
  inPerson = true;
}

// Pinoy Permit Plus and staff licenses: plans and bills, the free 3 people, the permit check, templates,
// the public permit page (and the page itself), the worker's upload link, and staff confirming payments.
{
  const newPage = async (g, vp = { width: 1280, height: 860 }) => {
    const page = await browser.newPage({ viewport: vp });
    await page.addInitScript((v) => { for (const [k, x] of Object.entries(v)) globalThis[k] = x; }, g);
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(450); };
    return { page, errs, go };
  };
  const mainText = (page) => page.textContent('main');

  // ---- a free workspace
  {
    const { page, errs, go } = await newPage({ PP_TEAM: true });
    await page.goto('http://localhost:4173/#/settings/billing'); await page.waitForSelector('main h1');
    await page.waitForSelector('[data-staff-calc]');
    check('plus: Plan shows Plus with a free trial, and staff licenses', (await page.locator('[data-act=plus-trial]').count()) === 1 && /Staff licenses/.test(await mainText(page)));
    await page.fill('[data-staff-calc] [name=people]', '25'); await page.waitForTimeout(100);
    const calc = await page.textContent('[data-staff-calc] .calc-out');
    check('plus: the price for 25 people is shown band by band (₱2,000 a month)', /17 people × ₱100/.test(calc) && /5 people × ₱60/.test(calc) && /₱2,000/.test(calc), calc.replace(/\s+/g, ' ').slice(0, 160));
    await page.click('[data-staff-calc] .bill-toggle input[value=yearly]', { force: true }); await page.waitForTimeout(100);
    check('plus: yearly is 10 months\' price (₱20,000)', /₱20,000/.test(await page.textContent('[data-staff-calc] .calc-out')));
    await page.click('[data-staff-calc] .bill-toggle input[value=monthly]', { force: true });
    await page.fill('[data-staff-calc] [name=people]', '10');
    await page.click('[data-staff-calc] button.btn-primary'); await page.waitForSelector('#modal-root .modal');
    check('plus: before any bill, the database\'s own price is confirmed (₱700)', /Get the bill: ₱700/.test(await page.textContent('#modal-root')));
    await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
    check('plus: the bill opens to pay, with GCash and bank details', /Pay bill PPA-/.test(await page.textContent('#modal-root')) && /GCash/.test(await page.textContent('#modal-root')));
    await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(200);
    check('plus: paying needs a reference or a screenshot', /reference number or a screenshot/.test(await page.textContent('#modal-root .modal-error')));
    await page.fill('#modal-root [name=ref]', '1009 234 567'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
    check('plus: reported: the bill waits for one check', /Checking your payment/.test(await mainText(page)));
    // staff confirm it
    await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=plus]'); await page.waitForTimeout(500);
    check('plus: staff see the payment to confirm', /Payments to confirm/.test(await mainText(page)) && (await page.locator('[data-act=addon-confirm]').count()) === 1);
    await page.click('[data-act=addon-confirm]'); await page.waitForSelector('#modal-root .modal');
    await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
    check('plus: confirmed: the plan shows as on', /Staff, up to 10/.test(await mainText(page)));
    await page.evaluate(async () => (await import('/js/core.js')).reload()); await go('#/settings/billing'); await page.waitForTimeout(300);
    check('plus: the customer sees licenses for up to 10 people', /Up to 10 people until/.test(await mainText(page)));
    // the free 3, then licenses
    await go('#/people');
    for (let i = 0; i < 10; i++) await page.evaluate(async (n) => (await import('/__mock/mock-data.js')).createPerson('o1', { full_name: 'Worker ' + n, types: [] }), i).catch(() => {});
    await page.evaluate(async () => (await import('/js/core.js')).reload()); await go('#/'); await go('#/people');
    check('plus: People shows how many of the licenses are used', /10 of 10/.test(await mainText(page)));
    await page.click('main [data-act=person-add]'); await page.waitForTimeout(300);
    check('plus: at the limit, Add person explains and offers licenses instead of failing', /Track more people/.test(await page.textContent('#modal-root')) && /Add staff licenses/.test(await page.textContent('#modal-root')));
    await page.click('#modal-root [data-modal-close]');
    // templates and the check, without Plus
    await go('#/templates');
    check('plus: everyone sees the templates', (await page.locator('main .tpl-card').count()) >= 2 && (await page.locator('[data-act=tpl-preview]').count()) >= 2);
    await page.click('[data-act=tpl-preview]'); await page.waitForTimeout(200);
    check('plus: free: a preview of the first lines only', /comes with Pinoy Permit Plus|filled in with your business/.test(await page.textContent('#modal-root')) && !/\{\{/.test(await page.textContent('#modal-root')));
    await page.click('#modal-root [data-modal-close]');
    await go('#/check'); await page.waitForSelector('.check-score');
    check('plus: free: the check says how many it found, and offers Plus for the list', /to fix/.test(await mainText(page)) && (await page.locator('.plus-teaser').count()) === 1 && (await page.locator('.finding').count()) === 0);
    // the trial
    await page.click('[data-act=plus-upsell]'); await page.waitForSelector('#modal-root .modal');
    await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
    check('plus: the 14-day trial starts from the pop-up', /Plus is on, free until/.test(await page.textContent('#toast')));
    await go('#/check'); await page.waitForSelector('.check-score');
    check('plus: with Plus the check lists each item with a fix', (await page.locator('.finding').count()) >= 1 && (await page.locator('.finding a.btn, .finding button.btn').count()) >= 1);
    check('plus: free → trial: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---- a Plus workspace (trial on, sample page, a photo a worker sent)
  for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
    const { page, errs, go } = await newPage({ PP_TEAM: true, PP_PLUS: true }, vp);
    await page.goto('http://localhost:4173/#/templates'); await page.waitForSelector('main .tpl-card');
    await page.click('[data-act=tpl-fill][data-code=authorization_letter]'); await page.waitForSelector('#modal-root .tpl-doc');
    let doc = await page.textContent('#modal-root .tpl-doc');
    check(`plus ${label}: a template fills in the business and the person`, doc.includes('Corner <Bakery> & Co') && doc.includes('Sadie Luna') && !doc.includes('{{'), doc.slice(0, 120));
    await page.fill('#modal-root [name=f_rep_name]', 'Ramon <b>Cruz</b>'); await page.waitForTimeout(100);
    doc = await page.textContent('#modal-root .tpl-doc');
    check(`plus ${label}: typing updates the letter, as plain text`, doc.includes('authorize Ramon <b>Cruz</b>') && (await page.locator('#modal-root .tpl-doc b').count()) === 0);
    const dl = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
    await page.click('#modal-root [data-tpl-doc]');
    const d = await dl;
    check(`plus ${label}: the letter downloads for Word`, !!d && /Authorization letter - .*\.doc$/.test(d.suggestedFilename()), d?.suggestedFilename());
    await page.click('#modal-root [data-modal-close]');
    // the check: answer a question
    await go('#/check'); await page.waitForSelector('.check-score');
    await page.click('[data-act=finding-dismiss]'); await page.waitForSelector('#modal-root .modal');
    await page.fill('#modal-root [name=note]', 'The building has one'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(700);
    check(`plus ${label}: "Doesn't apply" moves it to your answers, with Undo`, /You answered/.test(await mainText(page)) && (await page.locator('[data-act=finding-reopen]').count()) === 1);
    // people: the worker's photo, the not-cleared list, the link, roles
    await go('#/people');
    check(`plus ${label}: a lapsed license shows under Not cleared to work`, /Not cleared to work/.test(await mainText(page)) && /Jun Reyes/.test(await page.textContent('.not-cleared')));
    await page.click('[data-act=wsub-open]'); await page.waitForSelector('#modal-root .modal');
    check(`plus ${label}: the photo and its dates are shown to check`, (await page.locator('#modal-root .wsub-img').count()) === 1 && (await page.inputValue('#modal-root [name=reference_no]')) === 'HC-3310');
    await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(600);
    check(`plus ${label}: approved: it counts, and Jun is cleared`, /now shows the new dates/.test(await page.textContent('#toast')) && (await page.locator('.worker-subs').count()) === 0 && (await page.locator('.not-cleared').count()) === 0);
    await go('#/people/pp2'); await page.waitForSelector('.ask-card');
    await page.click('[data-act=wlink]'); await page.waitForSelector('#modal-root textarea');
    check(`plus ${label}: HR gets a message with the worker's own link`, /Hi Liza, please send a photo of your renewed NBI Clearance here/.test(await page.inputValue('#modal-root textarea')) && /#\/w\/[0-9a-f-]{36}/.test(await page.inputValue('#modal-root textarea')));
    await page.click('#modal-root [data-modal-close]');
    await go('#/people');
    await page.click('[data-act=staff-roles]'); await page.waitForSelector('#modal-root .modal');
    await page.fill('#modal-root [name=role]', 'Cook'); await page.check('#modal-root [name=types][value=health_certificate]');
    await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
    check(`plus ${label}: licenses by role are saved`, /People who are Cook need: Health Certificate/.test(await page.textContent('#toast')));
    // the public permit page, from Share proof
    await go('#/sharing'); await page.waitForSelector('.trust-card');
    check(`plus ${label}: the page shows its address, a QR code and both badges`, (await page.locator('.trust-card .qr-mini svg').count()) === 1 && (await page.locator('.trust-card .pp-badge').count()) === 1
      && (await page.locator('.trust-card .badge-preview').count()) === 1 && /p\.html\?c=k7m2q9xd4p/.test(await page.textContent('.trust-card')));
    const qrDl = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
    await page.click('[data-act=trust-qr-png]');
    check(`plus ${label}: the QR image downloads`, /permits QR\.png$/.test((await qrDl)?.suggestedFilename() || ''));
    await page.click('[data-act=trust-tab][data-tab=people]'); await page.waitForTimeout(400);
    check(`plus ${label}: requests and recipients are listed`, /Asked for updates/.test(await mainText(page)) && /Ana Reyes/.test(await mainText(page)));
    await page.click('[data-act=trust-yes]'); await page.waitForTimeout(400);
    check(`plus ${label}: saying yes adds them`, (await page.locator('[data-act=trust-yes]').count()) === 0 && /Ramon Cruz/.test(await mainText(page)));
    await page.fill('[data-trust-add] [name=name]', 'Bea Lim'); await page.fill('[data-trust-add] [name=email]', 'bea@landlord.ph');
    await page.click('[data-trust-add] button'); await page.waitForTimeout(400);
    check(`plus ${label}: adding a recipient`, /Bea Lim/.test(await mainText(page)));
    await page.click('[data-act=trust-tab][data-tab=views]'); await page.waitForTimeout(400);
    check(`plus ${label}: who looked: counts by where they came from`, /Last 30 days/.test(await mainText(page)) && /QR poster/.test(await mainText(page)));
    await page.click('[data-act=trust-tab][data-tab=settings]'); await page.waitForTimeout(200);
    await page.check('[data-trust-settings] [name=files][value=everyone]'); await page.click('[data-trust-settings] button.btn-primary'); await page.waitForTimeout(400);
    check(`plus ${label}: settings save`, /Saved\. The page shows it now/.test(await page.textContent('#toast')));
    await page.click('[data-act=trust-tab][data-tab=pack]'); await page.waitForTimeout(200);
    await page.fill('[data-trust-pack] [name=company]', 'Robinsons Supermarket');
    const packDl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click('[data-trust-pack] button');
    check(`plus ${label}: the accreditation pack downloads`, /accreditation pack for Robinsons Supermarket\.zip$/.test((await packDl)?.suggestedFilename() || ''));
    // paying for Plus after the trial keeps the free days
    await go('#/settings/billing'); await page.waitForSelector('[data-act=addon-choose][data-kind=plus]');
    await page.click('[data-act=addon-choose][data-kind=plus][data-billing=monthly]'); await page.waitForSelector('#modal-root .modal');
    check(`plus ${label}: paying during the trial keeps the free days`, /Your free days are kept/.test(await page.textContent('#modal-root')));
    await page.click('#modal-root [data-modal-close]');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`plus ${label}: no sideways scroll`, overflow <= 1, `overflow ${overflow}px`);
    check(`plus ${label}: no JavaScript errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---- the worker's link (no account)
  {
    const { page, errs } = await newPage({ PP_PLUS: true, PP_LOGGED_OUT: true }, { width: 390, height: 844 });
    await page.goto('http://localhost:4173/#/w/11111111-2222-4333-8444-555555555555'); await page.waitForSelector('#worker-form');
    check('worker: the link greets them by first name and names the license', /Hi Liza!/.test(await page.textContent('main')) && /NBI Clearance/.test(await page.textContent('main')) && !/Santos/.test(await page.textContent('main')));
    await page.click('#worker-form button.btn-primary'); await page.waitForTimeout(200);
    check('worker: a photo is needed', /Add a photo/.test(await page.textContent('#worker-form .form-error')));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('#worker-form [name=file]', { name: 'nbi.png', mimeType: 'image/png', buffer: png });
    await page.click('#worker-form button.btn-primary'); await page.waitForTimeout(200);
    check('worker: the new expiry date is needed', /expiry date/.test(await page.textContent('#worker-form .form-error')));
    const next = await page.evaluate(() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); });
    await page.fill('#worker-form [name=expires_on]', next);
    await page.click('#worker-form button.btn-primary'); await page.waitForTimeout(500);
    check('worker: sent', /Sent\. Thank you, Liza!/.test(await page.textContent('main')));
    await page.goto('http://localhost:4173/#/w/not-a-real-link'); await page.waitForTimeout(500);
    check('worker: a broken link says so', /isn't valid/.test(await page.textContent('main')));
    check('worker: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---- the public page and the badge (the database answers are stubbed)
  {
    const { page, errs } = await newPage({}, { width: 390, height: 844 });
    const H = '<img src=x onerror="window.__xss=1">';
    const live = { state: 'live', title: `Sadie's Kitchen ${H}`, intro: 'Family restaurant', business: "Sadie's Kitchen", city: 'Pasig City', as_of: '2026-10-20', now: new Date().toISOString(), checked_at: new Date().toISOString(),
      files: 'everyone', can_download: true, recipient: null, since: '2026-10-01', staff: { people: 12, licences: 14, ok: 13, due: 1, expired: 0 },
      items: [
        { id: 'a', name: "Mayor's / Business Permit", group: "Sadie's Kitchen", state: 'ok', in_progress: false, expires: true, expires_on: '2027-01-20', issuer: 'City of Pasig', ref: '•••• 0042', on_file: true, files: [{ path: 'o/a/mp.pdf', name: 'mp.pdf' }] },
        { id: 'b', name: `Fire Safety Inspection Certificate ${H}`, group: "Sadie's Kitchen", state: 'expired', in_progress: false, expires: true, expires_on: '2026-10-10', issuer: null, ref: null, on_file: false, files: null },
        { id: 'c', name: 'Sanitary Permit', group: "Sadie's Kitchen", state: 'due', in_progress: true, expires: true, expires_on: '2026-11-05', issuer: null, ref: null, on_file: true, files: null },
      ] };
    let asked = null;
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/rest/v1/rpc/get_trust_page', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(live) }));
    await page.route('**/rest/v1/rpc/trust_request_updates', (r) => { asked = r.request().postDataJSON(); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await page.route('**/rest/v1/rpc/trust_unsubscribe', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'true' }));
    await page.route('**/rest/v1/rpc/trust_badge', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'live', title: 'x', items: 3, ok: 1, due: 1, expired: 1, pending: 0, checked_at: new Date().toISOString() }) }));
    await page.goto('http://localhost:4173/p.html?c=k7m2q9xd4p&s=qr'); await page.waitForSelector('.tp-head');
    const t = await page.textContent('main');
    check('public page: the headline is honest (1 permit expired)', /1 permit expired/.test(t));
    check('public page: each permit shows its state and date', /Valid until Jan 20, 2027/.test(t) && /Expired/.test(t) && /Being renewed/.test(t) && /•••• 0042/.test(t));
    check('public page: says what Pinoy Permit does, and doesn\'t', /checked automatically by Pinoy Permit/.test(t) && /does not issue permits or verify them with the government/.test(t));
    check('public page: names are shown as text, never run', !(await page.evaluate(() => window.__xss)) && (await page.locator('main img[src=x]').count()) === 0);
    check('public page: copies can be downloaded when allowed', (await page.locator('.tp-files [data-path]').count()) === 1);
    check('public page: staff licenses as counts only', /14 for 12 people: 13 current, 1 due soon/.test(t));
    await page.fill('#ask-form [name=name]', 'Ramon'); await page.fill('#ask-form [name=email]', 'ramon@robinsons.ph');
    await page.click('#ask-form button'); await page.waitForTimeout(400);
    check('public page: asking for updates', /Request sent/.test(await page.textContent('main')) && asked?.p_email === 'ramon@robinsons.ph' && asked?.p_code === 'k7m2q9xd4p');
    await page.goto('http://localhost:4173/p.html?c=k7m2q9xd4p&r=11111111-2222-4333-8444-555555555555&stop=1'); await page.waitForSelector('#stop');
    check('public page: "Stop these emails" waits for a tap (email apps open links by themselves)', /Stop update emails\?/.test(await page.textContent('main')));
    await page.click('#stop'); await page.waitForTimeout(400);
    check('public page: stopped', /won't get these emails/.test(await page.textContent('main')));
    await page.unroute('**/rest/v1/rpc/get_trust_page');
    await page.route('**/rest/v1/rpc/get_trust_page', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'paused', title: 'Sadie' }) }));
    await page.goto('http://localhost:4173/p.html?c=k7m2q9xd4p'); await page.waitForTimeout(600);
    check('public page: paused shows no statuses', /not available right now/.test(await page.textContent('main')) && (await page.locator('.tp-line').count()) === 0);
    await page.goto('http://localhost:4173/p.html?c=BAD'); await page.waitForTimeout(400);
    check('public page: a broken link says so', /incomplete/.test(await page.textContent('main')));
    await page.goto('http://localhost:4173/badge.html#k7m2q9xd4p'); await page.waitForTimeout(600);
    check('badge: shows the live headline and links to the page', /1 permit expired/.test(await page.textContent('#badge')) && /p\.html\?c=k7m2q9xd4p&s=badge/.test(await page.getAttribute('#badge', 'href')));
    check('public page and badge: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---- an older database: nothing from Plus shows
  {
    const { page, errs, go } = await newPage({ PP_FEATURES: 'none', PP_TEAM: true });
    await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
    check('plus off: no Permit check or Templates in the menu', (await page.locator('.sidebar a[data-nav=check], .sidebar a[data-nav=templates]').count()) === 0);
    await go('#/settings/billing');
    check('plus off: no add-ons on the Plan page', (await page.locator('#addons').count()) === 0);
    await go('#/sharing');
    check('plus off: Share proof has no public page section', (await page.locator('#trust-root').count()) === 0);
    check('plus off: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }
}

// White-label: an accounting firm puts its name, logo and color on what its clients see, with
// "Powered by Pinoy Permit" always there.
{
  const newPage = async (g, vp = { width: 1280, height: 860 }) => {
    const page = await browser.newPage({ viewport: vp });
    await page.addInitScript((v) => { for (const [k, x] of Object.entries(v)) globalThis[k] = x; }, g);
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(450); };
    return { page, errs, go };
  };
  const mainText = (page) => page.textContent('main');
  const logo = fs.readFileSync(path.join(root, 'web/img/logo.png'));
  const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  // ---- the firm sets it up, tries it, and gets a bill
  for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
    const { page, errs, go } = await newPage({ PP_TEAM: true }, vp);
    await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
    await go('#/settings/billing');
    check(`brand ${label}: a business doesn't see White-label`, (await page.locator('#white-label').count()) === 0 && (await page.locator('.subnav a[href="#/settings/brand"]').count()) === 0);
    await page.evaluate(async () => { await (await import('/__mock/mock-data.js')).setOrgProfile('o1', { kind: 'firm' }); await (await import('/js/core.js')).reload(); });
    await go('#/settings/billing'); await page.waitForSelector('#white-label');
    const card = await page.textContent('#white-label');
    check(`brand ${label}: a firm sees White-label on the Plan page, ₱1,000 a month, 14 days free`, /₱1,000/.test(card) && /Powered by Pinoy Permit/.test(card) && (await page.locator('#white-label [data-act=brand-trial]').count()) === 1, card.replace(/\s+/g, ' ').slice(0, 120));
    check(`brand ${label}: Settings has a "Your brand" tab`, (await page.locator('.subnav a[href="#/settings/brand"]').count()) === 1);
    await go('#/settings/brand'); await page.waitForSelector('#brand-form');
    check(`brand ${label}: before it's on, the page says clients see it once White-label is on`, /once White-label is on/.test(await mainText(page)));
    check(`brand ${label}: the firm's name is filled in to start`, (await page.inputValue('#brand-form [name=display_name]')) === 'Aligned Solutions');
    await page.fill('#brand-form [name=color]', '#FFE066'); await page.waitForTimeout(80);
    check(`brand ${label}: a light color is flagged as hard to read`, /Too light/.test(await page.textContent('#color-msg')));
    await page.click('#brand-form button.btn-primary'); await page.waitForTimeout(200);
    check(`brand ${label}: ...and can't be saved`, /Pick a darker color/.test(await page.textContent('#toast')));
    await page.fill('#brand-form [name=color]', '#0F5132');
    await page.fill('#brand-form [name=display_name]', 'Dela Cruz <b>& Co.</b>');
    await page.fill('#brand-form [name=reply_to]', 'hello@delacruz.ph');
    await page.fill('#brand-form [name=phone]', '(02) 8123 4567');
    await page.fill('#brand-form [name=tagline]', 'Tax, books & permits'); await page.waitForTimeout(80);
    const prev = await page.textContent('.mail-prev');
    check(`brand ${label}: the email preview shows the firm as sender, replies to the firm, Powered by Pinoy Permit`,
      /Dela Cruz <b>& Co\.<\/b> via Pinoy Permit/.test(prev) && /replies to hello@delacruz\.ph/.test(prev) && /Powered by Pinoy Permit/.test(prev) && /Questions\? Email hello@delacruz\.ph or call \(02\) 8123 4567/.test(prev), prev.replace(/\s+/g, ' ').slice(0, 160));
    check(`brand ${label}: names show as typed, never as code`, (await page.locator('.mail-prev b b, .side-prev b b').count()) === 0);
    check(`brand ${label}: the preview button takes the color`, /rgb\(15, 81, 50\)/.test(await page.locator('.mail-prev .mp-btn').evaluate((e) => getComputedStyle(e).backgroundColor)));
    await page.setInputFiles('#brand-form [name=logo]', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(600 * 1024, 1) }); await page.waitForTimeout(150);
    check(`brand ${label}: a logo over 512 KB is refused before upload`, /over 512 KB/.test(await page.textContent('#toast')) && (await page.locator('[data-logo-box] img').count()) === 0);
    await page.setInputFiles('#brand-form [name=logo]', { name: 'logo.png', mimeType: 'image/png', buffer: logo }); await page.waitForTimeout(150);
    check(`brand ${label}: a chosen logo shows in the previews`, (await page.locator('[data-logo-box] img').count()) === 1 && (await page.locator('.mail-prev img').count()) === 1 && (await page.locator('.side-prev img').count()) === 1);
    await page.click('#brand-form button.btn-primary'); await page.waitForTimeout(500);
    check(`brand ${label}: saved, to show once it's on`, /Your clients see it once White-label is on/.test(await page.textContent('#toast')));
    check(`brand ${label}: saving keeps what was typed (and the logo)`, (await page.inputValue('#brand-form [name=display_name]')) === 'Dela Cruz <b>& Co.</b>' && (await page.locator('[data-logo-box] img').count()) === 1
      && (await page.inputValue('#brand-form [name=color]')) === '#0F5132');
    check(`brand ${label}: no sideways scroll on the brand page`, (await sideways(page)) <= 1, `${await sideways(page)}px`);
    await go('#/settings/billing'); await page.waitForSelector('#white-label');
    await page.click('#white-label [data-act=brand-trial]'); await page.waitForTimeout(700);
    check(`brand ${label}: the trial starts and goes to the brand page`, /White-label is on, free until/.test(await page.textContent('#toast')) && (await page.evaluate(() => location.hash)) === '#/settings/brand');
    await page.waitForSelector('#brand-form');
    check(`brand ${label}: now clients see the brand`, /Your clients see your brand/.test(await mainText(page)) && (await page.locator('.subnav a.active[href="#/settings/brand"]').count()) === 1);
    await go('#/settings/billing'); await page.waitForSelector('#white-label');
    check(`brand ${label}: the card shows the trial days left`, /Free trial: 14 days left/.test(await page.textContent('#white-label')) && (await page.locator('#white-label [data-act=brand-trial]').count()) === 0);
    await page.click('#white-label [data-act=addon-choose][data-billing=monthly]'); await page.waitForSelector('#modal-root .modal');
    const m = await page.textContent('#modal-root');
    check(`brand ${label}: paying keeps the free days and costs ₱1,000`, /White-label \(monthly\)/.test(m) && /when your trial ends/.test(m) && /Get the bill: ₱1,000/.test(m), m.replace(/\s+/g, ' ').slice(0, 160));
    await page.click('#modal-root [data-modal-close]');
    check(`brand ${label}: the firm's own app keeps Pinoy Permit's look`, (await page.locator('.sidebar .co-brand').count()) === 0);
    check(`brand ${label}: firm set-up: no JavaScript errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---- a client of the firm
  for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
    const { page, errs, go } = await newPage({ PP_TEAM: true, PP_BRAND: true }, vp);
    await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
    check(`brand ${label}: the client's menu shows the firm, Powered by Pinoy Permit`, /Dela Cruz & Co\./.test(await page.textContent('.sidebar .co-brand')) && /Powered by Pinoy Permit/.test(await page.textContent('.sidebar .powered-by')));
    if (label === 'phone') check('brand phone: the top bar shows the firm', await page.locator('.topbar .co-brand').isVisible());
    const vars = await page.evaluate(() => ['--brand', '--link', '--accent-soft'].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()));
    check(`brand ${label}: the app takes the firm's color (links a shade darker)`, vars[0] === '#0F5132' && /^#[0-9A-F]{6}$/.test(vars[1]) && /^#[0-9A-F]{6}$/.test(vars[2]), vars.join(' '));
    const fc = await page.textContent('.firm-card');
    check(`brand ${label}: the dashboard shows "Your accountant" with email and phone`, /Your accountant/.test(fc) && (await page.getAttribute('.firm-card a[href^="mailto:"]', 'href')) === 'mailto:hello@delacruz.ph'
      && (await page.getAttribute('.firm-card a[href^="tel:"]', 'href')) === 'tel:0281234567');
    check(`brand ${label}: ...and that the account stays theirs`, /Your Pinoy Permit account stays yours, free/.test(fc));
    check(`brand ${label}: no sideways scroll`, (await sideways(page)) <= 1, `${await sideways(page)}px`);
    await go('#/settings');
    check(`brand ${label}: a client has no "Your brand" tab`, (await page.locator('.subnav a[href="#/settings/brand"]').count()) === 0);
    await go('#/connect/tokfirm'); await page.waitForSelector('main h1');
    check(`brand ${label}: the invitation shows the firm's name and logo`, /Connect with Dela Cruz & Co\./.test(await page.textContent('main h1')) && (await page.locator('.connect-logo img').count()) === 1);
    check(`brand ${label}: client: no JavaScript errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---- invited by the firm, no account yet
  {
    const { page, errs } = await newPage({ PP_BRAND: true, PP_LOGGED_OUT: true }, { width: 390, height: 844 });
    await page.goto('http://localhost:4173/#/connect/tokfirm'); await page.waitForSelector('.auth-firm');
    check('brand: the sign-up page from the invitation shows the firm', /Dela Cruz & Co\./.test(await page.textContent('.auth-firm')) && (await page.locator('.auth-firm img').count()) === 1
      && /Dela Cruz & Co\. invited you to connect on Pinoy Permit/.test(await page.textContent('.auth-card .banner')));
    check('brand: sign-up page: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---- a database without the White-label file yet: nothing of it shows
  {
    const { page, errs, go } = await newPage({ PP_TEAM: true, PP_BRAND: true, PP_FEATURES: ['errors', 'assign', 'library2', 'services', 'import2', 'filings', 'sms', 'mfa', 'revenue', 'autorenew', 'leads', 'plus'] });
    await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
    check('brand off: clients see Pinoy Permit\'s own look', (await page.locator('.co-brand, .firm-card').count()) === 0);
    await page.evaluate(async () => { await (await import('/__mock/mock-data.js')).setOrgProfile('o1', { kind: 'firm' }); await (await import('/js/core.js')).reload(); });
    await go('#/settings/billing'); await page.waitForSelector('#addons');
    check('brand off: firms see no White-label card or tab', (await page.locator('#white-label, .subnav a[href="#/settings/brand"]').count()) === 0);
    check('brand off: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }
}

// Prices: plans with checkmarks, monthly or yearly (pay 10 months, get 12), add-ons and the staff price
// ladder, on the website and under Settings > Plan; paying a team plan for a year.
{
  const newPage = async (g, vp = { width: 1280, height: 860 }) => {
    const page = await browser.newPage({ viewport: vp });
    await page.addInitScript((v) => {
      for (const [k, x] of Object.entries(v)) globalThis[k] = x;
      try { if (!sessionStorage.getItem('pp-t')) { localStorage.removeItem('pp-billing'); sessionStorage.setItem('pp-t', '1'); } } catch { /* none */ } // start monthly, keep the choice on reload
    }, g);
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(450); };
    return { page, errs, go };
  };
  const firm = (page) => page.locator('[data-plan-card=firm]').first();
  for (const [label, vp] of [['phone', { width: 360, height: 760 }], ['desktop', { width: 1280, height: 860 }]]) {
    const { page, errs } = await newPage({ PP_LOGGED_OUT: true }, vp);
    await page.goto('http://localhost:4173/#/pricing'); await page.waitForSelector('#pricing [data-plan-card=property] .pp-amount');
    check(`prices ${label}: the website lists Free and the 3 team plans, each with checkmarks`, (await page.locator('#pricing .pp-plan.pp-free').count()) === 1
      && (await page.locator('#pricing [data-plan-card]').count()) === 4 && (await page.locator('#pricing [data-plan-card=firm] .pp-checks li').count()) >= 8);
    check(`prices ${label}: each plan shows a picture of its board and 3 big wins`, (await page.locator('#pricing [data-plan-card] .pp-preview').count()) === 4
      && (await page.locator('#pricing [data-plan-card=fleet] .pp-wins li').count()) === 3 && /Off the road/.test(await page.locator('#pricing [data-plan-card=fleet] .pp-preview').textContent()));
    check(`prices ${label}: the full list opens from "Everything included"`, !(await page.locator('#pricing [data-plan-card=firm] .pp-all .pp-checks').isVisible()));
    await page.locator('#pricing [data-plan-card=firm] .pp-all summary').click(); await page.waitForTimeout(100);
    check(`prices ${label}: ...and shows every checkmark`, await page.locator('#pricing [data-plan-card=firm] .pp-all .pp-checks').isVisible());
    const small = await page.locator('#pricing [data-plan-card=property_s]').textContent();
    check(`prices ${label}: a Small property plan for up to 20 tenants at ₱2,990`, /₱2,990/.test(small) && /up to 20 tenants/i.test(small) && /less than ₱150 a tenant/.test(small), small.replace(/\s+/g, ' ').slice(0, 160));
    const f = await firm(page).textContent();
    check(`prices ${label}: monthly shows the price, a day and per client`, /₱1,990\s*\/month/.test(f) && /less than ₱66 a day/.test(f) && /With 40 clients: less than ₱50 a client/.test(f), f.replace(/\s+/g, ' ').slice(0, 200));
    check(`prices ${label}: monthly also offers yearly with the saving`, /Pay yearly and get 2 months FREE: save ₱3,980/.test(f));
    const prop = await page.locator('#pricing [data-plan-card=property]').textContent();
    check(`prices ${label}: the property plan says why it costs more`, /Why it costs more/.test(prop) && /full-time admin/.test(prop) && /₱9,990/.test(prop));
    await page.locator('#pricing .bill-toggle input[value=yearly]').first().check({ force: true }); await page.waitForTimeout(150);
    const y = await firm(page).textContent();
    check(`prices ${label}: yearly shows 2 months free, the old price crossed out and the saving`, /2 months FREE/i.test(y) && /₱1,658\s*\/month/.test(y) && /₱23,880\s*₱19,900 once a year/.test(y) && /You save ₱3,980/.test(y), y.replace(/\s+/g, ' ').slice(0, 220));
    const cal = firm(page).locator('.year-cal');
    check(`prices ${label}: the next 12 months as calendar pages, the last 2 free`, (await cal.locator('.yc').count()) === 12 && (await cal.locator('.yc-free').count()) === 2
      && /FREE/.test(await cal.locator('.yc-free').first().textContent()) && /You pay \w{3} to \w{3}\. \w{3} and \w{3} are on us\./.test(await firm(page).textContent()));
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const thisMonth = months[Number(new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila' }).slice(5, 7)) - 1];
    check(`prices ${label}: the calendar starts this month`, (await cal.locator('.yc b').first().textContent()) === thisMonth);
    check(`prices ${label}: every switch on the page moved to yearly`, (await page.locator('.bill-toggle input[value=yearly]:checked').count()) === (await page.locator('.bill-toggle').count()));
    check(`prices ${label}: add-ons show the staff price ladder with savings`, /FREE/.test(await page.locator('#lp-staff .ladder').textContent()) && /40% off/.test(await page.locator('#lp-staff').textContent())
      && /60% off/.test(await page.locator('#lp-staff').textContent()) && /save ₱9,200/.test(await page.locator('#lp-staff .staff-ex').textContent()));
    check(`prices ${label}: Plus yearly is ₱1,990 with ₱398 saved`, /₱1,990 once a year/.test(await page.locator('#lp-plus').textContent()) && /You save ₱398/.test(await page.locator('#lp-plus').textContent()));
    await page.locator('#pricing .pp-compare summary').click(); await page.waitForTimeout(100);
    check(`prices ${label}: everything side by side`, (await page.locator('#pricing .pp-table tbody tr').count()) >= 15);
    await page.reload(); await page.waitForSelector('#pricing [data-plan-card=firm] .pp-amount');
    check(`prices ${label}: the choice is remembered on this device`, /₱1,658/.test(await firm(page).textContent()));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`prices ${label}: no sideways scroll on the website`, over <= 1, `${over}px`);
    check(`prices ${label}: website: no JavaScript errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // In the app: the Plan page, the add-ons switch, paying a team plan for a year.
  {
    const { page, errs, go } = await newPage({ PP_TEAM: true });
    await page.goto('http://localhost:4173/#/settings/billing'); await page.waitForSelector('#addons');
    check('prices app: the Plan page shows the plan cards', (await page.locator('main [data-plan-card]').count()) === 4 && (await page.locator('main .pp-free .chip', { hasText: 'Your plan' }).count()) === 1);
    const plusBtn = page.locator('#plus-card [data-act=addon-choose][data-kind=plus]');
    check('prices app: Plus is offered monthly', /₱199 a month/.test(await plusBtn.textContent()));
    await page.locator('main .bill-toggle input[value=yearly]').first().check({ force: true }); await page.waitForTimeout(150);
    check('prices app: switching to yearly changes the button too', /₱1,990 a year \(2 months free\)/.test(await plusBtn.textContent()) && (await plusBtn.getAttribute('data-billing')) === 'yearly');
    await plusBtn.click(); await page.waitForSelector('#modal-root .modal');
    check('prices app: the yearly bill is ₱1,990', /Pinoy Permit Plus \(yearly\)/.test(await page.textContent('#modal-root')) && /Get the bill: ₱1,990/.test(await page.textContent('#modal-root')));
    await page.click('#modal-root [data-modal-close]');
    await page.fill('[data-staff-calc] [name=people]', '50'); await page.waitForTimeout(100);
    const calc = await page.textContent('[data-staff-calc] .calc-out');
    check('prices app: the staff calculator shows the year and what the lower prices save', /₱35,000\s*a year/.test(calc) && /save you ₱12,000 a year/.test(calc), calc.replace(/\s+/g, ' ').slice(0, 200));
    await page.locator('main .bill-toggle input[value=monthly]').first().check({ force: true }); await page.waitForTimeout(100);
    // a firm in its trial pays for the year
    await page.evaluate(async () => { await (await import('/__mock/mock-data.js')).setOrgProfile('o1', { kind: 'firm' }); const c = await import('/js/core.js'); await c.reload(); c.S.profile.is_platform_admin = false; });
    await go('#/settings'); await go('#/settings/billing'); await page.waitForSelector('.pay-choice');
    const box = await page.textContent('.plan-pay');
    check('prices app: paying the plan offers a month or 12 months with 2 free', /1 month\s*₱1,990/.test(box) && /2 months FREE/i.test(box) && /12 months\s*₱19,900/.test(box) && /you save ₱3,980/.test(box), box.replace(/\s+/g, ' ').slice(0, 200));
    await page.click('[data-act=plan-request]'); await page.waitForSelector('#modal-root .modal');
    check('prices app: "I\'ve paid" asks what for, a year first', await page.isChecked('#modal-root [name=months][value="12"]'));
    await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
    check('prices app: the request is sent', /turn your plan on within 1 business day/.test(await page.textContent('#toast')));
    // staff record a yearly payment: 12 months cost 10
    await page.evaluate(async () => { (await import('/js/core.js')).S.profile.is_platform_admin = true; });
    await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=orgs]'); await page.waitForTimeout(400);
    await page.locator('main [data-act=plan-pay]').first().click(); await page.waitForSelector('#modal-root [name=months]');
    await page.selectOption('#modal-root [name=plan]', 'firm'); await page.fill('#modal-root [name=months]', '12'); await page.waitForTimeout(100);
    check('prices admin: a year of a team plan fills in 10 months\' price', Number(await page.inputValue('#modal-root [name=amount]')) === 19900);
    await page.click('#modal-root [data-modal-close]');
    check('prices app: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }
  // A property workspace picks Small property or Mall & property; staff licenses say what's tracked; firms vouch for themselves.
  {
    const { page, errs, go } = await newPage({ PP_TEAM: true, PP_DEMO: true });
    await page.goto('http://localhost:4173/#/settings/billing'); await page.waitForSelector('#staff-licenses');
    const staff = await page.textContent('#staff-licenses');
    check('prices staff: every kind of staff license is named, and the people do the renewing', /Health cards/.test(staff) && /Police clearances/.test(staff) && /PRC licenses/.test(staff)
      && /Security guard licenses/.test(staff) && /Any other you add/.test(staff) && /You just tap Approve/.test(staff));
    const bottoms = await page.locator('#staff-licenses .rung-track').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
    const heights = await page.locator('#staff-licenses .rung-bar').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    check('prices staff: every price bar stands on the same line, getting shorter as the price drops', bottoms.length === 4 && new Set(bottoms).size === 1 && heights[1] > heights[2] && heights[2] > heights[3] && heights[3] > heights[0], `${bottoms} / ${heights}`);
    await page.evaluate(async () => { await (await import('/__mock/mock-data.js')).setOrgProfile('o1', { kind: 'property' }); const c = await import('/js/core.js'); await c.reload(); c.S.profile.is_platform_admin = false; });
    await go('#/settings'); await go('#/settings/billing'); await page.waitForSelector('.pay-choice');
    const pay = await page.textContent('main section.card');
    check('prices property: in the trial, pay for Small property or Mall & property', (await page.locator('.plan-pay').count()) === 2 && /Small property/.test(pay) && /₱2,990/.test(pay) && /₱9,990/.test(pay) && /₱29,900/.test(pay));
    check('prices property: both property cards say they are in the trial', (await page.locator('[data-plan-card=property_s] .chip, [data-plan-card=property] .chip', { hasText: 'In your free trial' }).count()) === 2);
    await page.evaluate(async () => { (await import('/js/core.js')).S.profile.is_platform_admin = true; });
    await go('#/pros'); await page.waitForTimeout(300);
    const pros = await page.textContent('main');
    check('pros: no "checked" badge; customers are told firms vouch for themselves', !/Checked when listed/i.test(pros) && /Independent firms/.test(pros) && /doesn't check their papers/.test(pros));
    check('prices property/pros: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }
  // Team tools, for a business: the same cards, with a free trial button each.
  {
    const { page, errs } = await newPage({ PP_TEAM: true }, { width: 390, height: 844 });
    await page.goto('http://localhost:4173/#/network'); await page.waitForSelector('main [data-plan-card]');
    check('prices team tools: the plans with checkmarks and a trial button each', (await page.locator('main [data-plan-card]').count()) === 4 && (await page.locator('main [data-act=nb-set-kind]').count()) === 4);
    check('prices team tools: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }
}

// Pinoy Permit load: topping up (and staff confirming), text packs, the season pass, a papers check from asking to
// the staff answer, one template at a time, not enough load, invitations, a teammate's view, phones; and none of it
// before its database file is in.
for (const [label, vp] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp });
  await page.addInitScript(() => { globalThis.PP_SMS = true; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(500); };
  const mock = (fn) => page.evaluate(fn);
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const bal = async () => (await page.textContent('.load-amt')).trim();
  await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
  check(`load ${label}: "Load" is in the menu`, (await page.locator('.sidebar a[data-nav=load]').count()) === 1);
  await go('#/load'); await page.waitForSelector('.load-hero');
  check(`load ${label}: a new workspace starts at ₱0, with a Top up button`, (await bal()) === '₱0' && (await page.locator('[data-act=load-topup]').count()) === 1);
  check(`load ${label}: four things to use it on`, (await page.locator('.load-use').count()) === 4);
  check(`load ${label}: texts need a verified number first, and say where to add it`, /verified mobile number/.test(await page.locator('.load-use').first().textContent()));
  // top up ₱500 by GCash
  await page.click('[data-act=load-topup]'); await page.waitForSelector('#modal-root .modal');
  await page.check('#modal-root input[name=amount][value="500"]', { force: true });
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(400);
  check(`load ${label}: the top-up shows how to pay, with its number`, /Pay top-up L-\d{4}-\d{5}/.test(await page.textContent('#modal-root h3')) && /GCash/.test(await page.textContent('#modal-root')));
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(200);
  check(`load ${label}: "I've paid" needs the reference or a screenshot`, /reference number or a screenshot/.test(await page.textContent('#modal-root .modal-error')));
  await page.fill('#modal-root input[name=ref]', '1009 234 567'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
  check(`load ${label}: after paying, it says it's being checked`, /Checking your ₱500 payment/.test(await page.textContent('main')) && (await bal()) === '₱0');
  // staff confirm it
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=load]'); await page.waitForSelector('[data-act=adm-topup-ok]');
  check(`load ${label}: staff see it under Admin > Load`, /₱500/.test(await page.locator('[data-act=adm-topup-ok]').first().locator('xpath=ancestor::div[contains(@class,"line")]').textContent()));
  await page.click('[data-act=adm-topup-ok]'); await page.fill('#modal-root input[name=no]', 'SI-0101'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
  await go('#/load'); await page.waitForSelector('.load-hero');
  check(`load ${label}: confirmed: ₱500 is in, and the history says so`, (await bal()) === '₱500' && /Top-up L-\d{4}-\d{5}/.test(await page.textContent('.load-hist')));
  // texts, once a number is verified
  await mock(async () => { (await import('/__mock/mock-data.js')).__verifyPhone(); });
  await go('#/'); await go('#/load'); await page.waitForSelector('.load-hero');
  check(`load ${label}: with a verified number, two text packs to choose`, (await page.locator('[data-act=load-texts]').count()) === 2);
  await page.click('[data-act=load-texts][data-pack=texts_50]'); await page.waitForSelector('#modal-root .modal');
  check(`load ${label}: buying says the price and what's left`, /₱49/.test(await page.textContent('#modal-root')) && /₱451/.test(await page.textContent('#modal-root')));
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
  check(`load ${label}: 50 texts for ₱49`, (await bal()) === '₱451' && /50 text reminders left/.test(await page.textContent('.load-hero')));
  // the season pass (on sale September to January)
  const season = await mock(async () => (await (await import('/__mock/mock-data.js')).loadSummary()).season_on_sale);
  if (season) {
    await page.click('[data-act=load-season]'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(500);
    check(`load ${label}: the season pass is on, with its check waiting`, (await bal()) === '₱302' && /You have the \d{4} pass/.test(await page.textContent('main')) && /one free check waiting/.test(await page.textContent('main')));
  }
  // a papers check, from the permit's page
  const mp = await mock(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.type_code === 'mayors_permit' && r.business_id === 'b1').id);
  await go('#/requirement/' + mp); await page.waitForSelector('.papers-card');
  check(`load ${label}: a permit offers a papers check${season ? ', free with the pass' : ' for ₱149'}`, new RegExp(season ? 'free with your season pass' : '₱149').test(await page.textContent('.papers-card')));
  await page.click('[data-act=papers-open]'); await page.waitForSelector('#modal-root .modal');
  check(`load ${label}: the form lists the permit's checklist and the deadline`, (await page.locator('#modal-root .pc-list li').count()) >= 3 && /answers by/.test(await page.textContent('#modal-root')));
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(200);
  check(`load ${label}: it needs at least one photo when the permit has no files`, /photo/i.test(await page.textContent('#modal-root .modal-error')));
  await page.setInputFiles('#modal-root input[name=files]', [{ name: 'lease.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake') }, { name: 'cedula.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake') }]);
  await page.fill('#modal-root textarea[name=note]', 'We moved in March.');
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(700);
  check(`load ${label}: sent: the permit says it's being checked, by when`, /We're checking your papers/.test(await page.textContent('.papers-card')) && /\d{1,2}:\d{2}/.test(await page.textContent('.papers-card')));
  check(`load ${label}: both photos arrived`, (await mock(async () => (await import('/__mock/mock-data.js')).__load.files.length)) === 2);
  await page.click('[data-act=papers-cancel]'); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(600);
  check(`load ${label}: cancelling gives it back`, /Check my papers/.test(await page.textContent('.papers-card')));
  await page.click('[data-act=papers-open]'); await page.setInputFiles('#modal-root input[name=files]', [{ name: 'lease.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake') }]);
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(700);
  // staff answer it
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=load]'); await page.waitForSelector('[data-act=adm-papers]');
  await page.click('[data-act=adm-papers]'); await page.waitForSelector('#papers-answer');
  check(`load ${label}: staff see the photos and the checklist to answer`, (await page.locator('#papers-answer .pc-line').count()) >= 3 && /lease\.jpg/.test(await page.textContent('main')));
  await page.click('#papers-answer button'); await page.waitForTimeout(200);
  check(`load ${label}: staff must answer every line`, /Answer every line/.test(await page.textContent('#toast')));
  const n = await page.locator('#papers-answer .pc-line').count();
  for (let i = 0; i < n; i++) await page.locator(`#papers-answer input[name=s${i}][value=${i === 1 ? 'fix' : 'ok'}]`).check({ force: true });
  await page.fill('#papers-answer input[name=n1]', 'Bring the renewed lease.');
  await page.selectOption('#papers-answer select[name=verdict]', 'almost');
  await page.fill('#papers-answer textarea[name=summary]', 'One fix: the renewed lease. The rest is in order.');
  await page.click('#papers-answer button'); await page.waitForTimeout(600);
  await go('#/requirement/' + mp); await page.waitForSelector('.papers-card');
  const card = await page.textContent('.papers-card');
  check(`load ${label}: the customer sees the answer, line by line`, /Almost there/.test(card) && /Needs a fix/.test(card) && /Bring the renewed lease/.test(card) && /One fix: the renewed lease/.test(card));
  // one template at a time (no Plus here)
  await go('#/templates'); await page.waitForSelector('[data-act=tpl-unlock]');
  check(`load ${label}: without Plus, each template can be bought on its own`, /₱39/.test(await page.locator('[data-act=tpl-unlock]').first().textContent()));
  await page.locator('[data-act=tpl-unlock]').first().click(); await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(600);
  check(`load ${label}: bought: it's yours, and it fills in`, (await page.locator('main .chip', { hasText: 'Yours' }).count()) === 1);
  await page.locator('[data-act=tpl-fill]').first().click(); await page.waitForTimeout(500);
  check(`load ${label}: ...the fill-in form opens`, (await page.locator('#modal-root .modal').count()) === 1);
  await page.keyboard.press('Escape');
  // not enough load
  await mock(async () => { (await import('/__mock/mock-data.js')).__load.wallet.paid_php = 10; });
  await go('#/'); await go('#/load'); await page.waitForSelector('.load-hero');
  await page.click('[data-act=load-texts][data-pack=texts_200]'); await page.waitForSelector('#modal-root .modal');
  check(`load ${label}: not enough load offers a top-up for the difference`, /Not enough load/.test(await page.textContent('#modal-root h3')));
  await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(300);
  check(`load ${label}: ...with the amount picked`, /Top up your load/.test(await page.textContent('#modal-root h3')) && (await page.locator('#modal-root input[name=amount][value="200"]').isChecked()));
  await page.keyboard.press('Escape');
  // invitations
  check(`load ${label}: an invitation link to share`, /#\/signup\?ref=[A-Z0-9]{8}/.test(await page.textContent('[data-invite-link]')) && await page.locator('[data-act=invite-copy]').isEnabled());
  check(`load ${label}: no sideways scroll`, (await over()) <= 1, `${await over()}px`);
  // a teammate sees the balance, not the buttons
  await mock(async () => { const c = await import('/js/core.js'); c.S.org.role = 'member'; });
  await go('#/'); await go('#/load'); await page.waitForSelector('.load-hero');
  check(`load ${label}: a teammate sees the balance but can't spend it`, (await page.locator('[data-act=load-topup], [data-act=load-texts], [data-act=load-season]').count()) === 0
    && /owner or an admin/.test(await page.textContent('.load-hero')));
  await mock(async () => { const c = await import('/js/core.js'); c.S.org.role = 'owner'; });
  check(`load ${label}: no JavaScript errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}
{
  // the demo: a workspace that has used its load
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript(() => { globalThis.PP_DEMO = true; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4173/#/load'); await page.waitForSelector('.load-hero');
  check('load demo: a balance, texts, a history and invitations', /₱302/.test(await page.textContent('.load-hero')) && (await page.locator('.load-hist .line').count()) >= 4 && /2 businesses have joined/.test(await page.textContent('main')));
  check('load demo: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
  // before database file 9: nothing about load anywhere
  const off = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await off.addInitScript(() => { globalThis.PP_FEATURES = ['errors', 'assign', 'library2', 'services', 'filings', 'sms', 'mfa', 'revenue', 'plus']; });
  const oerrs = [];
  off.on('pageerror', (e) => oerrs.push(e.message));
  await off.goto('http://localhost:4173/'); await off.waitForSelector('main h1');
  check('load off: no Load in the menu', (await off.locator('.sidebar a[data-nav=load]').count()) === 0);
  await off.evaluate(() => { location.hash = '#/load'; }); await off.waitForTimeout(500);
  check('load off: #/load goes back to the dashboard', !/Prepaid credit/.test(await off.textContent('main')));
  const mp = await off.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.type_code === 'mayors_permit').id);
  await off.evaluate((id) => { location.hash = '#/requirement/' + id; }, mp); await off.waitForTimeout(600);
  check('load off: permits offer no papers check', (await off.locator('.papers-card').count()) === 0);
  check('load off: no JavaScript errors', oerrs.length === 0, oerrs.slice(0, 3).join(' | '));
  await off.close();
  // invited: the sign-up page says so
  const inv = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await inv.addInitScript(() => { globalThis.PP_LOGGED_OUT = true; });
  await inv.goto('http://localhost:4173/#/signup?ref=K7M2Q9XD'); await inv.waitForSelector('.auth-card');
  check('load invite: the sign-up page says a business invited them', /A business you know invited you/.test(await inv.textContent('.auth-card')));
  await inv.close();
}

// The processing clock (starting it, a deadline passing, the follow-up letter and the ARTA complaint, closing it) and
// city bills (paying one yourself; Pinoy Permit paying one, from the customer's payment to staff confirming, paying and
// filing the receipt), a teammate's view, phones.
for (const [label, vp] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp, acceptDownloads: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(500); };
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const submit = async (wait = 500) => { await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(wait); };
  await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
  const req = await page.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.type_code === 'mayors_permit' && r.status !== 'compliant'));
  await go('#/requirement/' + req.id); await page.waitForSelector('#clock');
  check(`clock ${label}: a permit being renewed offers to start the clock`, /Waiting on the office/.test(await page.textContent('#clock')));
  await page.click('[data-act=clock-start]'); await page.waitForSelector('.modal');
  check(`clock ${label}: the office's name is guessed from the permit and the city`, /Business Permits and Licensing Office/.test(await page.inputValue('.modal [name=office]')));
  check(`clock ${label}: it shows the legal deadline as you fill it in`, /By law, the office has until/.test(await page.textContent('.modal .clock-preview')));
  await page.check('.modal input[name=kind][value=charter]'); await submit(200);
  check(`clock ${label}: a Citizen's Charter time needs its days`, /Citizen's Charter/.test(await page.textContent('#modal-root .modal-error')));
  await page.check('.modal input[name=kind][value=simple]');
  await page.fill('.modal [name=reference_no]', 'BPLO-2027-555');
  await submit();
  check(`clock ${label}: started: 3 working days left, with the deadline`, /3 working days left/.test(await page.textContent('#clock .chip')) && /By law, it has until/.test(await page.textContent('#clock')));
  await page.click('#clock [data-act=clock-edit]'); await page.waitForSelector('.modal [name=filed_on]');
  const twoWeeks = await page.evaluate(() => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(d.getUTCDate() - 14); return d.toISOString().slice(0, 10); });
  await page.fill('.modal [name=filed_on]', twoWeeks);
  await page.selectOption('.modal [name=fees]', 'paid'); await page.fill('.modal [name=fees_paid_on]', twoWeeks);
  await submit();
  check(`clock ${label}: past the deadline: late, with the follow-up letter and the ARTA complaint on offer`, /Late by/.test(await page.textContent('#clock .chip')) && /past its deadline/.test(await page.textContent('#clock'))
    && (await page.locator('#clock [data-act=clock-letter][data-kind=followup]').count()) === 1 && (await page.locator('#clock [data-act=clock-letter][data-kind=complaint]').count()) === 1);
  await page.click('#clock [data-act=clock-letter][data-kind=followup]'); await page.waitForSelector('.modal .letter-text');
  const letter = await page.inputValue('.modal .letter-text');
  check(`clock ${label}: the follow-up letter cites the law, the dates and the reference, and that it's deemed approved (fees paid)`,
    /Republic Act No\. 11032/.test(letter) && /BPLO-2027-555/.test(letter) && /deemed approved/.test(letter) && /within one \(1\) working day/.test(letter), letter.slice(0, 160));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal [data-letter=word]')]);
  check(`clock ${label}: the letter downloads for Word`, /^Follow-up letter - .*\.doc$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  check(`clock ${label}: the follow-up pop-up only closes (nothing to save)`, (await page.locator('#modal-root button[type=submit]').count()) === 0);
  await page.click('.modal [data-modal-close]'); await page.waitForTimeout(500);
  check(`clock ${label}: drafting it is remembered on the card and in the permit's activity`, /Follow-up letter drafted/.test(await page.textContent('#clock')) && /Drafted a follow-up letter/.test(await page.textContent('main')));
  await page.click('#clock [data-act=clock-letter][data-kind=complaint]'); await page.waitForSelector('.modal .letter-text');
  const arta = await page.inputValue('.modal .letter-text');
  check(`clock ${label}: the ARTA complaint has what ARTA asks for, and mentions the follow-up`, /Anti-Red Tape Authority/.test(arta) && /Office concerned:/.test(arta) && /We wrote to the office on/.test(arta)
    && (await page.getAttribute('.modal a[href^="https://ecms.arta.gov.ph"]', 'target')) === '_blank');
  await page.fill('.modal [name=arta_ref]', 'ARTA-2027-77'); await submit();
  check(`clock ${label}: the ARTA reference is kept`, /ARTA reference ARTA-2027-77/.test(await page.textContent('#clock')));
  check(`clock ${label}: no sideways scroll`, (await over()) <= 0);
  await page.click('#clock [data-act=clock-close]'); await page.waitForSelector('.modal');
  await submit();
  check(`clock ${label}: got it: the clock stops and says how late the office was`, /working days? late/.test(await page.textContent('#clock')) && /Waiting on the office/.test(await page.textContent('#clock')));

  // the offer: Pinoy Permit pays it, flat fee, up front
  check(`bills ${label}: the card offers "Let Pinoy Permit pay it" at ₱499 flat, with why`, /Let Pinoy Permit pay it: ₱499 flat/.test(await page.textContent('#bills'))
    && (await page.locator('#bills .bill-offer-list li').count()) === 3 && !/guarantee|we pay the surcharge|we cover/i.test(await page.textContent('#bills')));
  await page.click('#bills .bill-offer [data-act=bill-add]'); await page.waitForSelector('.modal');
  check(`bills ${label}: the offer opens with Pinoy Permit paying already chosen, and it's shown first`, await page.isChecked('.modal input[name=mode][value=permitpal]')
    && (await page.locator('.modal .bill-modes label').first().getAttribute('class')).includes('bill-mode-pp'));
  await page.click('.modal [data-modal-close]');
  // bills: kept on record, paid yourself
  await page.click('#bills [data-act=bill-add]:not([data-mode])'); await page.waitForSelector('.modal');
  check(`bills ${label}: "pay it myself" opens with paying yourself chosen`, await page.isChecked('.modal input[name=mode][value=self]'));
  await page.fill('.modal [name=amount]', '650.5'); await page.fill('.modal [name=bill_ref]', 'BC-118');
  await submit();
  check(`bills ${label}: a bill kept on record: centavos shown, to pay`, /₱650\.50/.test(await page.textContent('#bills')) && /To pay/.test(await page.textContent('#bills')));
  check(`bills ${label}: a bill you'll pay yourself offers to switch to Pinoy Permit`, (await page.locator('#bills [data-act=bill-switch]').count()) === 1);
  await page.click('#bills [data-act=bill-switch]'); await page.waitForSelector('.modal');
  check(`bills ${label}: switching carries the details over, Pinoy Permit chosen`, (await page.inputValue('.modal [name=amount]')) === '650.5' && await page.isChecked('.modal input[name=mode][value=permitpal]'));
  await page.click('.modal [data-modal-close]');
  await page.click('#bills [data-act=bill-paid]'); await page.waitForSelector('.modal');
  await submit(200);
  check(`bills ${label}: paying it needs the receipt number or a photo`, /official receipt/.test(await page.textContent('#modal-root .modal-error')));
  await page.fill('.modal [name=or_no]', 'OR-55120');
  await page.setInputFiles('.modal input[type=file]', { name: 'or.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
  await submit();
  check(`bills ${label}: paid: the receipt is with the permit's files`, /official receipt OR-55120/.test(await page.textContent('#bills')) && /Official receipt OR-55120/.test(await page.textContent('main')));
  // Pinoy Permit pays one
  await page.click('#bills [data-act=bill-add]'); await page.waitForSelector('.modal');
  await page.check('.modal input[name=mode][value=permitpal]');
  await page.fill('.modal [name=amount]', '14230.50');
  check(`bills ${label}: Pinoy Permit paying shows what you send (the bill plus ₱499)`, /You send ₱14,729\.50/.test(await page.textContent('.modal .bill-total')));
  await submit(200);
  check(`bills ${label}: ...and needs a photo of the bill`, /photo of the bill/.test(await page.textContent('#modal-root .modal-error')));
  await page.setInputFiles('.modal input[name=file]', { name: 'soa.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
  await page.click('#modal-root button[type=submit]'); await page.waitForSelector('.modal .quote-hint');
  check(`bills ${label}: saved: straight to paying Pinoy Permit, with the payment details`, /₱14,729\.50/.test(await page.textContent('.modal .quote-hint')) && (await page.locator('.modal .paywith').count()) >= 1);
  await page.fill('.modal [name=ref]', '1009 555 0001'); await submit();
  check(`bills ${label}: paid: we check it`, /Checking your payment/.test(await page.textContent('#bills')));
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=office]'); await page.waitForTimeout(700);
  check(`bills ${label}: staff see it to confirm`, /₱14,729\.50/.test(await page.textContent('main')));
  await page.click('[data-act=adm-bill-ok]'); await page.waitForSelector('.modal'); await submit(700);
  check(`bills ${label}: confirmed: it's on the list to pay, with the time we promised`, (await page.locator('[data-act=adm-bill-paid]').count()) === 1 && /By /.test(await page.textContent('main .chip.soon, main .chip.overdue')));
  await page.click('[data-act=adm-bill-paid]'); await page.waitForSelector('.modal');
  await submit(200);
  check(`bills ${label}: paying needs the official receipt`, /Please fill in/.test(await page.textContent('#modal-root .modal-error')));
  await page.fill('.modal [name=or_no]', 'OR-7731905'); await page.setInputFiles('.modal input[type=file]', { name: 'or.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
  await submit(700);
  await go('#/requirement/' + req.id); await page.waitForSelector('#bills');
  check(`bills ${label}: the customer sees it paid, with the receipt on the permit`, /Pinoy Permit paid it: official receipt OR-7731905/.test(await page.textContent('#bills')) && /Official receipt OR-7731905/.test(await page.textContent('main')));
  check(`bills ${label}: no sideways scroll`, (await over()) <= 0);
  await page.evaluate(async () => { const c = await import('/js/core.js'); c.S.org.role = 'member'; });
  await page.click('#bills [data-act=bill-add]'); await page.waitForSelector('.modal');
  check(`bills ${label}: a teammate can keep a bill, but only an owner or admin has Pinoy Permit pay`, await page.isDisabled('.modal input[name=mode][value=permitpal]'));
  await page.click('.modal [data-modal-close]');
  await page.evaluate(async () => { const c = await import('/js/core.js'); c.S.org.role = 'owner'; });
  check(`clock+bills ${label}: no JavaScript errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}
// Staff: a bill we can't pay goes back, the holiday calendar, the fee, the clock on an order we filed; the demo; before file 10.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript(() => { globalThis.PP_DEMO = true; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(600); };
  const submit = async (wait = 600) => { await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(wait); };
  await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
  const mp = await page.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.business_id === 'b1' && r.type_code === 'mayors_permit').id);
  await go('#/requirement/' + mp); await page.waitForSelector('#clock');
  check('clock demo: an office past its deadline, with the letters ready', /Late by/.test(await page.textContent('#clock .chip')) && (await page.locator('#clock [data-act=clock-letter]').count()) === 2);
  check('bills demo: a bill Pinoy Permit is paying, and when', /We're paying it/.test(await page.textContent('#bills')) && /by .*(AM|PM)/i.test(await page.textContent('#bills')));
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=office]'); await page.waitForTimeout(700);
  check('admin: the late office is listed', /Late by/.test(await page.textContent('main')) && /Makati Business Permits and Licensing Office/.test(await page.textContent('main')));
  await page.click('[data-act=adm-bill-refund]'); await page.waitForSelector('.modal'); await submit(200);
  check("admin: sending a bill back needs the reason the customer will read", /Please fill in/.test(await page.textContent('#modal-root .modal-error')));
  await page.fill('.modal [name=note]', 'Makati only takes this payment at its own window.'); await page.fill('.modal [name=ref]', 'GC-1'); await submit(700);
  await go('#/requirement/' + mp); await page.waitForSelector('#bills');
  check('bills demo: sent back: the customer sees why', /Sent back to you/.test(await page.textContent('#bills')) && /own window/.test(await page.textContent('#bills')));
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=office]'); await page.waitForTimeout(700);
  await page.click('[data-act=adm-holiday-add]'); await page.waitForSelector('.modal');
  await page.fill('.modal [name=day]', '2027-06-24'); await page.fill('.modal [name=name]', 'Araw ng Maynila'); await submit(700);
  check('admin: a day off is added to the calendar', (await page.locator('.hol-row', { hasText: 'Araw ng Maynila' }).count()) === 1);
  await page.click('.hol-more summary'); await page.click('[data-act=adm-holiday-remove][data-day="2027-06-24"]'); await page.waitForTimeout(700);
  check('admin: ...and removed', (await page.locator('.hol-row', { hasText: 'Araw ng Maynila' }).count()) === 0);
  await page.fill('.adm-bill-settings [name=fee]', '120'); await page.click('[data-act=adm-bill-settings]'); await page.waitForTimeout(600);
  await go('#/requirement/' + mp); await page.waitForSelector('#bills');
  await page.click('#bills [data-act=bill-add]'); await page.waitForSelector('.modal');
  check('admin: a new fee shows to customers at once', /₱120/.test(await page.textContent('.modal')));
  await page.click('.modal [data-modal-close]');
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=orders]'); await page.waitForTimeout(600);
  await page.click('[data-act=admin-order][data-id=ord1]'); await page.waitForTimeout(500);
  check('admin: an order we filed offers to start the clock', (await page.locator('[data-act=adm-clock-start]').count()) === 1);
  await page.click('[data-act=adm-clock-start]'); await page.waitForSelector('.modal');
  await page.fill('.modal [name=office]', 'BFP Mandaue'); await page.fill('.modal [name=reference_no]', 'FSIC-88'); await submit(700);
  const fsicId = await page.evaluate(async () => (await import('/__mock/mock-data.js')).__office.filings.find((f) => f.request_id === 'ord1')?.requirement_id);
  await go('#/requirement/' + fsicId); await page.waitForSelector('#clock');
  check('clock: on an order we filed, the customer sees the clock and that we follow up', /BFP Mandaue/.test(await page.textContent('#clock')) && /Pinoy Permit filed this for you/.test(await page.textContent('#clock'))
    && (await page.locator('#clock [data-act=clock-edit]').count()) === 0);
  check('clock+bills demo: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
  const off = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await off.addInitScript(() => { globalThis.PP_FEATURES = ['errors', 'assign', 'library2', 'services', 'filings', 'sms', 'mfa', 'revenue', 'plus', 'load']; });
  const oerrs = [];
  off.on('pageerror', (e) => oerrs.push(e.message));
  await off.goto('http://localhost:4173/'); await off.waitForSelector('main h1');
  const anyReq = await off.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.status !== 'compliant').id);
  await off.evaluate((id) => { location.hash = '#/requirement/' + id; }, anyReq); await off.waitForTimeout(700);
  check('clock+bills off: before database file 10, permits show neither card', (await off.locator('#clock, #bills').count()) === 0);
  await off.evaluate(() => { location.hash = '#/admin'; }); await off.waitForTimeout(600);
  check('clock+bills off: ...and staff have no Bills & clock tab', (await off.locator('[data-act=admin-tab][data-tab=office]').count()) === 0);
  check('clock+bills off: no JavaScript errors', oerrs.length === 0, oerrs.slice(0, 3).join(' | '));
  await off.close();
}

// Renewal packets (only the questions still open, one at a time; the printed packet, the .zip, the copy kit, changing
// answers) and city deadlines (the banner and one tap on the permit and the dashboard, Quezon City's rule, staff
// announcing, replacing and withdrawing an extension, the notice), on a desktop and a phone; switched off; the demo.
for (const [label, vp] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp, acceptDownloads: true });
  await page.addInitScript(() => { globalThis.PP_CITY = true; globalThis.PP_QC = true; window.print = () => { globalThis.__printed = (globalThis.__printed || 0) + 1; }; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(600); };
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const submit = async (wait = 500) => { await page.click('#modal-root button[type=submit]'); await page.waitForTimeout(wait); };
  const modalErr = () => page.textContent('#modal-root .modal-error');
  const lastToast = () => page.locator('.toast').last().textContent();
  const reqNow = (id) => page.evaluate(async (i) => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.id === i), id);
  await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
  const mp = await page.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.business_id === 'b1' && r.type_code === 'mayors_permit'));
  const ext = await page.evaluate(async () => (await import('/__mock/mock-data.js')).__city.deadlines[0] || null);

  // ---- city deadline: the permit's banner, "Keep" hides it here; the dashboard gathers it, one tap moves the date
  if (ext) {
    await go('#/requirement/' + mp.id); await page.waitForSelector('[data-packet]');
    check(`city ${label}: the permit says the city extended its deadline, with the source`, /extended the \d{4} business permit deadline/.test(await page.textContent('[data-city-banner]'))
      && (await page.locator('[data-city-banner] a[target=_blank]').count()) === 1);
    await go('#/');
    check(`city ${label}: the dashboard offers the new date too`, (await page.locator('[data-city-banner] [data-act=city-use]').count()) === 1);
    await page.click('[data-city-banner] [data-act=city-use]'); await page.waitForTimeout(700);
    const now = (await reqNow(mp.id)).expires_on;
    check(`city ${label}: one tap moves the permit to the new date, and the banner goes`, now === ext.due_on && (await page.locator('[data-city-banner]').count()) === 0, now);
  } else check(`city ${label}: (no extension possible on this date; skipped)`, true);

  // ---- Quezon City: a year from the issue date
  const qc = await page.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.business_id === 'bq'));
  await go('#/requirement/' + qc.id); await page.waitForSelector('[data-city-banner]');
  check(`city ${label}: Quezon City's rule is offered on a QC permit that took January 20`, /Quezon City counts a year from the issue date/.test(await page.textContent('[data-city-banner]')));
  await page.click('[data-city-banner] [data-act=city-keep]'); await page.waitForTimeout(300);
  await go('#/'); await go('#/requirement/' + qc.id);
  check(`city ${label}: "Keep" hides it, and it stays hidden`, (await page.locator('[data-city-banner]').count()) === 0);
  await page.evaluate(() => localStorage.clear()); await go('#/'); await go('#/requirement/' + qc.id); await page.waitForSelector('[data-city-banner]');
  await page.click('[data-city-banner] [data-act=city-rule-use]'); await page.waitForTimeout(700);
  const qcNow = await reqNow(qc.id);
  check(`city ${label}: one tap: due a year from the issue date`, qcNow.expires_on.slice(5) === '03-15' && Number(qcNow.expires_on.slice(0, 4)) === Number(qcNow.issued_on.slice(0, 4)) + 1
    && (await page.locator('[data-city-banner]').count()) === 0, qcNow.expires_on);

  // ---- the packet: only what's missing, a question at a time
  await go('#/requirement/' + mp.id); await page.waitForSelector('[data-packet]');
  check(`packet ${label}: the card says how much is already filled in and what's left`, /already has \d+ of \d+ details/.test(await page.textContent('[data-packet]'))
    && /4 questions left/.test(await page.textContent('[data-packet]')));
  await page.click('[data-act=packet-start]'); await page.waitForSelector('.modal [name=sales]');
  check(`packet ${label}: one question at a time, numbered`, /1 of 4/.test(await page.textContent('#modal-title')));
  await submit(300);
  check(`packet ${label}: the sales are needed`, /Please fill in/.test(await modalErr()));
  await page.fill('.modal [name=sales]', 'a lot'); await submit(300);
  check(`packet ${label}: ...as an amount in pesos`, /Enter the sales in pesos/.test(await modalErr()));
  await page.fill('.modal [name=sales]', '₱1,842,600.50'); await submit();
  await page.waitForSelector('.modal [name=employees]');
  await page.fill('.modal [name=employees]', '6'); await page.fill('.modal [name=employees_local]', '9'); await submit(300);
  check(`packet ${label}: people living in the city can't be more than everyone`, /up to 6/.test(await modalErr()));
  await page.fill('.modal [name=employees_local]', '4'); await submit();
  await page.waitForSelector('.modal [name=changed]');
  await submit(300);
  check(`packet ${label}: "anything changed" needs a yes or no`, /Choose yes or no/.test(await modalErr()));
  await page.check('.modal [name=changed][value=yes]'); await submit(300);
  check(`packet ${label}: "yes" asks what changed`, /Say briefly what changed/.test(await modalErr()) && await page.isVisible('.modal [name=changes]'));
  await page.fill('.modal [name=changes]', 'Bigger space next door'); await submit();
  await page.waitForSelector('.modal [name=tin]');
  check(`packet ${label}: the last question asks only for the details Pinoy Permit doesn't have`, (await page.locator('.modal [name=tin]').count()) === 1 && (await page.locator('.modal [name=owner_name]').count()) === 0);
  await page.click('.modal [data-pk-back]'); await page.waitForSelector('.modal [name=changes]');
  check(`packet ${label}: Back keeps the answer`, (await page.inputValue('.modal [name=changes]')) === 'Bigger space next door');
  await submit(); await page.waitForSelector('.modal [name=tin]');
  await page.fill('.modal [name=tin]', '123-456-789-000'); await page.fill('.modal [name=street]', '12 Jupiter St, Bel-Air');
  if (await page.locator('.modal [name=phone]').count()) await page.fill('.modal [name=phone]', '0917 123 4567');
  if (await page.locator('.modal [name=reg_no]').count()) await page.fill('.modal [name=reg_no]', 'CS201912345');
  await page.fill('.modal [name=area_sqm]', '42');
  await page.check('.modal [name=place][value=rented]'); await page.fill('.modal [name=lessor]', 'Jupiter <Realty>');
  await page.click('#modal-root button[type=submit]'); await page.waitForSelector('[data-packet].ready');
  check(`packet ${label}: built: ready, with the sales and what's in it`, /Ready/.test(await page.textContent('[data-packet]')) && /₱1,842,600\.5/.test(await page.textContent('[data-packet]'))
    && /Sworn declaration/.test(await page.textContent('[data-packet]')) && (await page.locator('#modal-root .modal').count()) === 0);
  const tin = await page.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).businesses.find((b) => b.id === 'b1').tin);
  check(`packet ${label}: the TIN is saved on the business, for every page`, tin === '123-456-789-000', tin);
  check(`packet ${label}: the permit's activity says it's ready`, /Renewal packet for \d{4} is ready/.test(await page.textContent('main')));
  await page.click('[data-act=packet-print]'); await page.waitForTimeout(300);
  const sheet = await page.evaluate(() => document.getElementById('print-sheet')?.textContent || '');
  check(`packet ${label}: the printout has the checklist, the details, the declaration and the letter`, /Bring or upload/.test(sheet) && /Application details/.test(sheet)
    && /SWORN DECLARATION OF GROSS SALES/.test(sheet) && /PHP 1,842,600\.50/.test(sheet) && /AUTHORIZATION LETTER/.test(sheet) && /Jupiter <Realty>/.test(sheet)
    && /Bigger space next door/.test(sheet) && (await page.evaluate(() => globalThis.__printed)) >= 1);
  check(`packet ${label}: customer text stays text in the printout`, await page.evaluate(() => !document.querySelector('#print-sheet realty')));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=packet-zip]')]);
  check(`packet ${label}: the .zip downloads with the packet's name`, /renewal packet \d{4}\.zip$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await page.click('[data-act=packet-copy]'); await page.waitForSelector('.modal .copy-row');
  check(`packet ${label}: the copy kit lists each detail with a Copy button`, (await page.locator('.modal .copy-row').count()) >= 12 && /123-456-789-000/.test(await page.textContent('.modal'))
    && (await page.locator('.modal [data-copy]').count()) === (await page.locator('.modal .copy-row').count()));
  check(`packet ${label}: copy kit has no sideways scroll`, (await over()) <= 0);
  await page.click('.modal [data-modal-close]');
  await page.click('[data-act=packet-edit]'); await page.waitForSelector('.modal [name=sales]');
  check(`packet ${label}: changing answers goes through all four, filled in`, /1 of 4/.test(await page.textContent('#modal-title')) && (await page.inputValue('.modal [name=sales]')) === '1,842,600.5');
  await page.click('.modal [data-modal-close]');
  check(`packet ${label}: no sideways scroll`, (await over()) <= 0);

  // ---- staff announce an extension; the customer is told; replacing and withdrawing it
  const [y, due1, due2] = await page.evaluate((exp) => {
    const t = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 10);
    const add = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const yy = exp.slice(0, 4); const end = `${yy}-12-31`;
    return [yy, [add(t, 10), end].sort()[0], [add(t, 20), end].sort()[0]];
  }, mp.expires_on);
  const open = await page.evaluate(() => new Date().getMonth()) < 11 && due1 > mp.expires_on && due2 > due1;
  // start over: the permit back on its first date (the dashboard moved it above), and no extension yet
  await go('#/'); await page.reload(); await page.waitForSelector('main h1');
  await page.evaluate(async () => { (await import('/__mock/mock-data.js')).__city.deadlines.forEach((d) => { d.withdrawn_at ||= new Date().toISOString(); }); });
  Object.assign(mp, await page.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.business_id === 'b1' && r.type_code === 'mayors_permit')));
  await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=cities]'); await page.waitForSelector('.adm-city-form');
  check(`city admin ${label}: the city list counts business permits, QC spellings together`, /Makati City/.test(await page.textContent('main')) && /QC|Quezon/.test(await page.textContent('.city-counts')));
  await page.fill('.adm-city-form [name=city]', 'Makati City'); await page.click('[data-act=adm-city-add]'); await page.waitForTimeout(300);
  check(`city admin ${label}: the date and the link are needed`, /new deadline/.test(await lastToast()));
  if (open && (await page.locator(`.adm-city-form [name=year] option[value="${y}"]`).count())) {
    await page.selectOption('.adm-city-form [name=year]', y); await page.fill('.adm-city-form [name=due_on]', due1);
    await page.fill('.adm-city-form [name=source_url]', 'notice.ph'); await page.click('[data-act=adm-city-add]'); await page.waitForTimeout(300);
    check(`city admin ${label}: the link must be a real https link`, /https/.test(await lastToast()) && (await page.locator('.modal').count()) === 0);
    await page.fill('.adm-city-form [name=source_url]', 'https://example.com/makati-ordinance');
    await page.click('[data-act=adm-city-add]'); await page.waitForSelector('.modal');
    check(`city admin ${label}: it asks before telling anyone, and says how many`, /Up to 1 workspace/.test(await page.textContent('.modal')));
    await submit(800);
    check(`city admin ${label}: announced: workspaces told`, /Told 1 workspace/.test(await lastToast()) && /Live/.test(await page.textContent('main')));
    await go('#/notifications');
    check(`city ${label}: the notice is in Notifications, with "See the new date"`, (await page.locator('a', { hasText: 'See the new date' }).count()) >= 1);
    await page.locator('a', { hasText: 'See the new date' }).first().click(); await page.waitForTimeout(700);
    await page.click('[data-city-banner] [data-act=city-use]'); await page.waitForTimeout(700);
    check(`city ${label}: the customer takes the new date`, (await reqNow(mp.id)).expires_on === due1);
    await go('#/admin'); await page.click('[data-act=admin-tab][data-tab=cities]'); await page.waitForSelector('.adm-city-form');
    await page.fill('.adm-city-form [name=city]', 'Makati City'); await page.selectOption('.adm-city-form [name=year]', y);
    await page.fill('.adm-city-form [name=due_on]', due2); await page.fill('.adm-city-form [name=source_url]', 'https://example.com/makati-ordinance-2');
    await page.click('[data-act=adm-city-add]'); await page.waitForSelector('.modal');
    check(`city admin ${label}: a second date says it replaces the first`, /This replaces/.test(await page.textContent('.modal')));
    await submit(800);
    check(`city admin ${label}: replaced: the permit that took the first date moves along`, (await reqNow(mp.id)).expires_on === due2 && /1 moved along/.test(await lastToast()));
    await page.locator('[data-act=adm-city-withdraw]').first().click(); await page.waitForSelector('.modal');
    check(`city admin ${label}: withdrawing says what happens to moved permits`, /go back to their old date/.test(await page.textContent('.modal')));
    await submit(800);
    check(`city admin ${label}: withdrawn: the permit is back on its first date`, (await reqNow(mp.id)).expires_on === mp.expires_on && /Withdrawn/.test(await page.textContent('main')));
  } else check(`city admin ${label}: (too close to year end to announce; skipped)`, true);
  check(`city admin ${label}: no sideways scroll`, (await over()) <= 0);
  check(`packet+city ${label}: no JavaScript errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}
{
  // The demo: a ready packet and a sample extension; and a database before file 11 shows neither.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { globalThis.PP_DEMO = true; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4173/'); await page.waitForSelector('main h1');
  check('packet demo: the dashboard shows the sample extension, marked as a sample', /A sample/.test(await page.textContent('[data-city-banner]').catch(() => '')) || (await page.locator('[data-city-banner]').count()) === 0);
  const id = await page.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.location_id === 'l3' && r.type_code === 'mayors_permit').id);
  await page.evaluate((h) => { location.hash = h; }, '#/requirement/' + id); await page.waitForSelector('[data-packet]');
  check('packet demo: a ready packet, with last year\'s answers carried over', /Ready/.test(await page.textContent('[data-packet]')) && /₱7,348,250\.75/.test(await page.textContent('[data-packet]')));
  check('packet demo: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
  const off = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await off.addInitScript(() => { globalThis.PP_CITY = true; globalThis.PP_FEATURES = ['errors', 'assign', 'library2', 'services', 'filings', 'sms', 'mfa', 'revenue', 'plus', 'load', 'clock', 'billpay']; });
  const oerrs = [];
  off.on('pageerror', (e) => oerrs.push(e.message));
  await off.goto('http://localhost:4173/'); await off.waitForSelector('main h1');
  const mp = await off.evaluate(async () => (await (await import('/__mock/mock-data.js')).loadOrgData()).reqs.find((r) => r.type_code === 'mayors_permit').id);
  check('packet+city off: before database file 11, the dashboard has no city banner', (await off.locator('[data-city-banner]').count()) === 0);
  await off.evaluate((id) => { location.hash = '#/requirement/' + id; }, mp); await off.waitForTimeout(700);
  check('packet+city off: ...and the permit has no packet or banner', (await off.locator('[data-packet], [data-city-banner]').count()) === 0);
  await off.evaluate(() => { location.hash = '#/admin'; }); await off.waitForTimeout(600);
  check('packet+city off: ...and staff have no City deadlines tab', (await off.locator('[data-act=admin-tab][data-tab=cities]').count()) === 0);
  check('packet+city off: no JavaScript errors', oerrs.length === 0, oerrs.slice(0, 3).join(' | '));
  await off.close();
}

// No guarantees and no card checkout: the terms put penalties on the business, and payment is GCash, Maya or bank only.
{
  const req = (await browser.newContext()).request;
  const terms = await (await req.get('http://localhost:4173/terms.html')).text();
  const privacy = await (await req.get('http://localhost:4173/privacy.html')).text();
  check('terms: no on-time guarantee, no surcharge payouts, no "free if late"', !/on-time guarantee|we pay the surcharge|we pay back the late penalty|it's free: what you paid/i.test(terms)
    && /Penalties stay yours/.test(terms) && /Surcharges stay yours/.test(terms) && /we make no guarantees/.test(terms));
  check('terms and privacy: no card checkout or PayMongo', !/online checkout|PayMongo/i.test(terms + privacy));
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript(() => { globalThis.PP_KIND = 'fleet'; });
  await page.goto('http://localhost:4173/#/settings/billing'); await page.waitForSelector('main h1'); await page.waitForTimeout(600);
  check('plans: no "pay online" or card checkout button anywhere', (await page.locator('[data-act=plan-checkout], [data-act=order-pay-online], [data-act=load-online], [data-act=addon-online]').count()) === 0
    && !/GCash, Maya or card|Pay online/.test(await page.textContent('main')));
  await page.goto('http://localhost:4173/#/admin'); await page.waitForSelector('main h1');
  await page.click('[data-act=admin-tab][data-tab=payments]'); await page.waitForTimeout(500);
  check('admin: no "Show Pay online" switch', (await page.locator('[name=online_payments]').count()) === 0);
  await page.close();
}

// Renewal guides (renew/): plain pages search engines can read, with the checklist, the dates, a calendar
// file and the penalty estimate. Built by scripts/build-city-pages.mjs at the top of this file.
{
  const { CITIES } = await import('../../scripts/renew-cities.mjs');
  const marikina = CITIES.find((c) => c.slug === 'marikina');
  for (const [label, vp] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 360, height: 740 }]]) {
    const page = await browser.newPage({ viewport: vp });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); // web fonts are cosmetic; tests run offline
    await page.addInitScript(() => { globalThis.PP_LOGGED_OUT = true; }); // a visitor, for the "Start free" link
    await page.goto('http://localhost:4173/renew/');
    check(`guides ${label}: the index lists every city`, (await page.locator('.rn-city').count()) === CITIES.length);
    check(`guides ${label}: the countdown to January 20 is filled in`, /days from today|Tomorrow|Today|passed/.test(await page.textContent('[data-countdown]')));
    check(`guides ${label}: the 2026 table links each city to its page`, (await page.locator('.rn-table tbody th a').count()) === (await page.locator('.rn-table tbody tr').count()));
    check(`guides ${label}: index has no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.click('.rn-city:has-text("Marikina")'); await page.waitForSelector('h1');
    check(`guides ${label}: a city page has its name, both checklists and the facts with their sources`, /Marikina/.test(await page.textContent('h1'))
      && (await page.locator('.rn-step').count()) === 2 && (await page.locator('.rn-list li').count()) >= 10
      && (await page.locator('.rn-facts li small a').count()) === marikina.facts.length && (await page.locator('.rn-links a').count()) === marikina.official.length);
    check(`guides ${label}: outside links open in a new tab and say so`, await page.evaluate(() => [...document.querySelectorAll('a[target=_blank]')].every((a) => a.rel.includes('noopener') && /^https:/.test(a.href) && /new tab/.test(a.textContent))));
    check(`guides ${label}: the estimate starts with an example`, (await page.textContent('[data-v=total]')) === '₱1,375');
    await page.fill('[data-penalty] [name=base]', '10000'); await page.selectOption('[data-penalty] [name=months]', '3'); await page.waitForTimeout(100);
    check(`guides ${label}: the estimate follows the law's limits (25% + 2% a month)`, (await page.textContent('[data-v=surcharge]')) === '₱2,500' && (await page.textContent('[data-v=interest]')) === '₱750'
      && (await page.textContent('[data-v=total]')) === '₱3,250' && (await page.textContent('[data-v=months]')) === '3 months');
    await page.fill('[data-penalty] [name=base]', ''); await page.waitForTimeout(50);
    check(`guides ${label}: an empty amount shows ₱0, not an error`, (await page.textContent('[data-v=total]')) === '₱0');
    const cal = await page.request.get(new URL(await page.getAttribute('.rn-due a[download]', 'href'), page.url()).href);
    const ics = await cal.text();
    check(`guides ${label}: the calendar file is a real calendar with 4 dates`, /text\/calendar/.test(cal.headers()['content-type']) && ics.startsWith('BEGIN:VCALENDAR\r\n')
      && (ics.match(/BEGIN:VEVENT/g) || []).length === 4 && /DTSTART;VALUE=DATE:\d{4}0120/.test(ics) && ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
    check(`guides ${label}: city page has no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.click('.rn-cta .btn'); await page.waitForSelector('.auth-card, main h1');
    check(`guides ${label}: "Start free" opens sign-up in the app`, /#\/signup/.test(page.url()));
    check(`guides ${label}: no JavaScript errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }
  // Every guide: one h1, a title, a description and a canonical address, and every link inside the site works.
  const req = (await browser.newContext()).request;
  const pages = ['renew/', ...CITIES.map((c) => `renew/${c.slug}/`)];
  const bad = [];
  const seen = new Set();
  for (const rel of pages) {
    const body = await (await req.get('http://localhost:4173/' + rel)).text();
    if ((body.match(/<h1[\s>]/g) || []).length !== 1 || !/<title>[^<]{20,}<\/title>/.test(body) || !/<meta name="description" content="[^"]{60,}"/.test(body)
      || !body.includes(`<link rel="canonical" href="https://siggiebahamas.github.io/PermitPal/${rel}">`)) bad.push(rel + ' (head)');
    for (const [, href] of body.matchAll(/href="([^"]+)"/g)) {
      const u = new URL(href.replace(/&amp;/g, '&'), 'http://localhost:4173/' + rel);
      if (u.origin !== 'http://localhost:4173') continue;
      const path = u.pathname;
      if (seen.has(path)) continue;
      seen.add(path);
      if (!(await req.get(u.origin + path)).ok()) bad.push(`${rel} -> ${href}`);
    }
  }
  check('guides: every page has one h1, a title, a description and its canonical address; every inside link works', bad.length === 0, bad.slice(0, 5).join(' | '));
  const map = await (await req.get('http://localhost:4173/sitemap.xml')).text();
  check('guides: the sitemap lists every guide', pages.every((p) => map.includes(`/PermitPal/${p}</loc>`)));
  const home = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await home.addInitScript(() => { globalThis.PP_LOGGED_OUT = true; });
  await home.goto('http://localhost:4173/'); await home.waitForSelector('.lp-foot');
  check('guides: the home page footer links to the guides', (await home.locator('.lp-foot a[href="renew/"]').count()) === 1);
  await home.close();
}

await browser.close();
server.close();
for (const [s, n, e] of results) console.log(`${s} ${n}${s === 'FAIL' && e ? ' -> ' + e : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
