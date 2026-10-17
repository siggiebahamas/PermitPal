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
  for (const h of ['#/compliance', '#/businesses/b1', '#/team', '#/settings/workspace', '#/admin']) {
    await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250);
    if (await page.locator('main .who, main .handled, [data-act=bulk-toggle], #esc-form, [data-tab=errors]').count()) seen.push(h);
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
