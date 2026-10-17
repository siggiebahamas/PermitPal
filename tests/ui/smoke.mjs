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
const types = { '.gz': 'application/gzip', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  let file = p.startsWith('/__mock/') ? path.join(root, 'tests/ui', p.slice(8)) : path.join(root, 'web', p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
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
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
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

    // Removing a staff licence that doesn't apply returns to that staff member (it used to go to a missing vehicle page).
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
    check('removing a staff licence returns to that staff member', personHash.startsWith('#/people/') && (await page.evaluate(() => location.hash)) === personHash, personHash);
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

    // Contact PermitPal: an empty message is refused with a message, a filled one is sent.
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
  check('checklist: a step tracked elsewhere shows its live status', /In PermitPal: Compliant until/.test(await page.textContent('.ck-list')));
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
  check('done for you: offered on the permit page with the starting price', /Have PermitPal renew it for you/.test(await page.textContent('.checklist .offer-inline')) && /₱2,500/.test(await page.textContent('.checklist .offer-inline')));
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
  check('done for you: the permit now says PermitPal is handling it', /PermitPal is handling this/.test(await page.textContent('main .banner.progress')) && (await page.locator('.checklist .offer-inline', { hasText: 'Open request' }).count()) === 1);
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
  for (const h of ['#/compliance', '#/businesses/b1', '#/team', '#/settings/workspace', '#/admin', '#/requirement/' + mp, '#/']) {
    await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250);
    if (await page.locator('main .who, main .handled, [data-act=bulk-toggle], #esc-form, [data-tab=errors], [data-tab=orders], .checklist, .offer-inline, .lib-more, .focus-alt, .sidebar [data-nav=services], .sidebar [data-nav=filings], [data-filings-brief]:not([hidden]), #staff-access').count()) seen.push(h);
  }
  check('features off: nothing new shows before the database is updated', seen.length === 0, seen.join(','));
  check('features off: no JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

await browser.close();
server.close();
for (const [s, n, e] of results) console.log(`${s} ${n}${s === 'FAIL' && e ? ' -> ' + e : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
