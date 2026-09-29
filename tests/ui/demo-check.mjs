import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/web/demo.html');
await p.waitForSelector('main h1');
for (const h of ['#/businesses/b1', '#/vehicles', '#/compliance', '#/settings', '#/team', '#/admin']) { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(200); }
console.log('title:', await p.textContent('main h1'), '| errors:', errs.length ? errs : 'none');
await b.close();
