# Pinoy Permit: handoff for a new Claude Code session

Read this first, then `README.md`. Everything below was true at commit `d6e5582` (October 23, 2026) plus the commit that added this file.

## What it is
Pinoy Permit tracks Philippine business permits, vehicle registrations and staff licenses, reminds before they expire, and makes renewing easier (checklists, renewal packets, the processing clock, city bills, done-for-you orders). The founder is Sigmund Ty. **Pinoy Permit makes filing easier; it never takes on a customer's penalties, surcharges or deadlines.**

## Where things live
- **Code:** GitHub `siggiebahamas/permitpal`, branch `main`. Pushing to `main` deploys: `.github/workflows/deploy.yml` runs unit tests and the full browser smoke test, builds the renewal guides and the demo, then publishes to GitHub Pages at https://siggiebahamas.github.io/PermitPal/.
- **Front end:** plain JavaScript modules in `web/js` (no framework). Views in `web/js/views`, the data layer `web/js/data.js` (Supabase client), with `html` tagged templates (`web/js/util.js`). `when(cond, a, b)` evaluates both branches, so use a ternary when a branch reads possibly-null data. Actions use `on('name', fn)` and `data-act` attributes; newer features only show when `has('feature')` is true, which comes from the database's `private.features` table.
- **Database:** Supabase project `zeaiwvgktakbwnqpchbo` (Pinoy Permit). **Never touch the Nifti project `ctryvcloavfpecbrbzxy`.** The schema is `supabase/migrations/*.sql`. The founder applies changes by hand in the Supabase SQL Editor from `supabase/manual/*.sql` (each is all-or-nothing, checks the previous file ran, and refuses to run twice).
- **Edge functions:** `supabase/functions/`. `create-checkout` and `paymongo-webhook` exist but are no longer used: no card checkout anywhere.

## Database files: run order (in `supabase/manual/`)
1. `2026-10-17-new-features.sql`  2. `2026-10-19-revenue.sql` (already run on the live project)
3. `2026-10-20-autorenew.sql`  4. `2026-10-21-leads.sql`  5. `2026-10-22-plus.sql`  6. `2026-10-23-whitelabel.sql`
7. `2026-10-24-yearly.sql`  8. `2026-10-25-small-property.sql`  9. `2026-10-26-load.sql`  10. `2026-10-27-clock-and-bills.sql`
11. `2026-10-28-packets-and-city-dates.sql`  12. `2026-10-29-pinoy-permit.sql` (the name change)

The founder said (October 23) that files 1 to 11 are run on the live project; file 12 is new. Whether file 11 was run before commit `d6e5582` is still unconfirmed: check the live `private.features` table (each file adds a name: autorenew, leads, plus, brand, yearly, property_s, load, clock + billpay, packet + citydates). If file 11 was run before commit `d6e5582`, its later changes (₱499 fee, guarantee removal, no auto-refund on late papers checks) are missing: write a small file 12 with just those changes instead of editing file 11. A new database change = a new migration in `supabase/migrations/` **and** a matching `supabase/manual/` file with the same guard pattern, plus a test in `supabase/tests/`.

## Decisions already made (don't undo them)
- **No guarantees, no liability for penalties.** The terms (`web/terms.html`) say penalties and surcharges stay with the business. Removed: the on-time guarantee, the late-bill surcharge promise, and the papers-check refund when an answer is late. Don't add any promise to pay penalties.
- **The name is Pinoy Permit** (it was PermitPal). Written as two words; the wordmark is `<span class="w1">Pinoy</span> <span class="w2">Permit</span>`. The GitHub repo and the site's `/PermitPal/` address keep the old spelling until a domain is bought, and so do stored codes (bill mode `'permitpal'`) and calendar event IDs (`@permitpal`), so nothing breaks for existing data.
- **No card checkout (PayMongo).** Payment is GCash, Maya or bank transfer, and staff confirm it in Admin.
- **Paying a city bill through Pinoy Permit costs ₱499**, an app setting (`billpay_fee`) editable in Admin → Bills & clock. The bill card shows a "Skip the line" offer. Keep it honest: no fake countdowns or fake scarcity.
- **Online-only for now:** in-person services and Year-round care are switched off (`IN_PERSON` in `web/js/core.js`).
- **Not to build:** the liaison handoff, and bots that sign in or pay on city websites (QC E-Services etc.): stored passwords, site terms and constant breakage. Use the packet's copy kit instead.
- City deadline extensions are posted by staff in Admin → City deadlines, always with a source link. Quezon City uses "one year from the issue date".

## Testing (run before every push)
- Unit: `npm ci` then `node --test tests/unit.test.mjs`
- Browser smoke test (in-memory data in `tests/ui/mock-data.js`, the real CSP): `node tests/ui/smoke.mjs`. It needs Playwright's Chromium (in Claude Code cloud sessions it's at `/opt/pw-browsers/chromium`). The last run was 959/959.
- SQL tests on a local Postgres 16: `bash supabase/tests/local/start.sh`, `bash supabase/tests/local/reset.sh pplocal`, then `bash supabase/tests/local/run.sh pplocal supabase/tests/0[6-9]_*.sql supabase/tests/[12]*.sql`. Tests 06 to 21 all passed. 01 to 05 use an older format and aren't run with this runner.
- Any UI change needs the mock (`tests/ui/mock-data.js`) and smoke checks updated with it.

## Rules
- No secrets in the repo, and never copy `cron_secret` anywhere. Never put model names in commits or code.
- Keep Pinoy Permit separate from other repositories (for example SadieCutie).
- Writing style for anything customers read: plain, short, American spelling, no jargon.
- The founder wants direct answers under 300 words, recommendations rather than "it depends", no unrequested tools, and no suggestions to hire anyone.
