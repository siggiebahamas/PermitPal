# PermitPal

One place for every business permit and vehicle registration, with reminders before anything expires, and help renewing when you don't want to do it yourself.

- **Website:** static HTML/JS in `web/`, hosted on GitHub Pages: `https://siggiebahamas.github.io/PermitPal/` (sign-in) and `https://siggiebahamas.github.io/PermitPal/demo/` (the same app on sample data, no sign-in). Both update on every push to `main`.
- **Backend:** Supabase project `zeaiwvgktakbwnqpchbo`: Postgres database, logins, private file storage, scheduled jobs and Edge Functions.

## What's where

| Path | What it is |
|---|---|
| `supabase/migrations/` | The whole database in order: tables, access rules, status engine, History log, reminders, help requests, teams, billing. Already applied to the live project. |
| `supabase/functions/` | `send-messages` (email/SMS/WhatsApp sender), `maintenance` (erases deleted workspaces after 30 days), `create-checkout` + `paymongo-webhook` (payments). Already deployed. |
| `supabase/tests/` | Database tests. They roll themselves back, so nothing is kept. |
| `web/` | The app. `js/data.js` is the only file that talks to the backend. |
| `tests/` | `unit.test.mjs` (rules and safety helpers) and `ui/smoke.mjs` (drives every page in a real browser). |
| `.github/workflows/` | Deploy on push, nightly encrypted backup, keep-alive ping. |

## How it decides status

The database decides status in one place (`requirement_status`), using Philippine time. The dashboard, lists, reminders and emails all read that same answer.

- **Needs info:** never recorded, no expiry date on something that expires, or no document uploaded yet. A new item is never shown as compliant.
- **Overdue / Renew soon:** past the expiry date / expires within 30 days.
- **In progress:** you clicked "I've started the renewal", or you have an open help request.
- **Compliant:** a document is on file and nothing is due within 30 days.
- **Renewing** adds a new record and keeps the old one and its file as history. Until the new document is uploaded it shows *Needs info*, not *Compliant*.

## How it's set up (same pattern as Nifti and Buzz, free tiers only)

- **GitHub** holds the code and hosts the site. Every push to `main` runs the tests, then publishes `web/` to the `gh-pages` branch (like Buzz).
- **Supabase (free plan)** holds logins, data and files. `.mcp.json` links this repo to project `zeaiwvgktakbwnqpchbo` (like Nifti). `keep-alive.yml` pings it every 2 days so the free project never pauses.
- **Free mode:** everyone is on the Free plan with no limits. Billing and SMS/WhatsApp (they cost per message) are switched off; their code stays in place for later.
- **Backups:** the nightly GitHub Action (free for public repos) takes over from Supabase Pro backups.

## Go-live checklist (things only you can do)

**Blockers (the site can't take real customers without these):**
0. **Database changes waiting:** in Supabase → SQL Editor, run `supabase/manual/2026-10-17-new-features.sql`, then `supabase/manual/2026-10-19-revenue.sql`, then `supabase/manual/2026-10-20-autorenew.sql`, then `supabase/manual/2026-10-21-leads.sql`, then `supabase/manual/2026-10-22-plus.sql`, then `supabase/manual/2026-10-23-whitelabel.sql`, then `supabase/manual/2026-10-24-yearly.sql`, then `supabase/manual/2026-10-25-small-property.sql` (each once, in that order; each is all-or-nothing and refuses to run twice). Until then the site hides every feature they add.
1. **Domain + email:** buy a `.com` domain (cheapest reliable: Cloudflare Registrar, about US$10.44/year at cost; a `.ph` costs about US$41-45/year). Create a free [Resend](https://resend.com) account and verify the domain. Then:
   - Supabase → Authentication → Emails → SMTP Settings: enter Resend's SMTP details. Until then, new customers can't confirm sign-up.
   - Supabase → Edge Functions → Secrets: add `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `PermitPal <hello@yourdomain.com>`). This turns on reminders, invitations, quote requests, team reminders and Contact form emails.
   - Admin → Messages → "Send me a test email" to confirm it works.
2. **Logins:** Supabase → Authentication → URL Configuration: Site URL `https://siggiebahamas.github.io/PermitPal/` (or your domain once it points here), and add it to Redirect URLs. (Claude's Supabase connection cannot change Auth settings, so this one is a paste in the dashboard.)
3. **Your admin account:** sign up with the email set as the admin notification address and confirm it. It becomes staff automatically.
4. **Backups:** the nightly schedule is on and skips until these 4 repository secrets exist (GitHub → Settings → Secrets and variables → Actions):
   `SUPABASE_DB_URL` (Supabase → Connect → Session pooler string, with your database password), `SUPABASE_URL` (`https://zeaiwvgktakbwnqpchbo.supabase.co`),
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API keys → secret key), `BACKUP_PASSPHRASE` (any long random phrase; keep it in a password manager, backups can't be opened without it).
   Then Actions → Nightly backup → Run workflow once to check it.
5. **Register PermitPal as a business** (DTI, barangay, Mayor's Permit, BIR) before taking the first payment: business customers need an invoice.

**Before charging:**
6. **Payments:** GCash and UnionBank details are set (Admin → Payment details). Every payment is confirmed by you in the app (Orders, Care, Partner billing, or Workspaces & plans → "Record a payment"), and Admin → Money lists any payment still missing its BIR invoice number.
7. **Online checkout (optional):** add `PAYMONGO_SECRET_KEY` and `APP_URL` as Edge Function secrets, then tick "Pay online" in Admin → Payment details.
8. **Professionals:** add real liaison firms and accountants in Admin → Professionals (their email receives quote requests), or approve the ones that apply on the "For service providers" page. Tick "License checked" only after seeing their business permit and license. Choose how each firm pays: per quote request from prepaid credit (record each payment with "Add credit"; a firm pauses by itself when its credit can't cover one more request), a flat monthly listing, or free. Firms report bad leads from the link in each lead email within 7 days; decide them in Admin → Partner billing → Reported leads (accepting puts the fee back on their credit). Monthly listings and checklist lines are still billed by statement from Partner billing. Insurers: per-request fees are blocked until your Insurance Commission license number is saved (Insurance Code, Sec. 307). The sample firms exist only in the demo.
8b. **Year-round care and the on-time guarantee:** prices, and the list of permits each plan renews, are in Admin → Care. Two ways to pay (after `supabase/manual/2026-10-20-autorenew.sql`): Pay per renewal, ₱0 a month, where each renewal care starts is quoted at the service's usual price; and the All-in plan, ₱1,200/month or ₱12,000/year per branch and ₱250/month or ₱2,500/year per vehicle, with every covered renewal included and the on-time guarantee. Keep the Pay per renewal tiers at ₱0. One-time renewals from ₱1,500 (Mayor's Permit ₱6,000, FSIC ₱3,000, LTO ₱2,000). Licenses outside a plan's list (FDA, DOH, franchises, contractor licenses, permits customers add themselves) are quoted as one-time jobs. Have a lawyer read the "Year-round care" and "On-time guarantee" sections of the terms before the first sale; the guarantee is written as a service guarantee for your own misses, not insurance.
8c. **PermitPal Plus and staff licenses** (after `supabase/manual/2026-10-22-plus.sql`): Plus is ₱199/month or ₱1,990/year (14-day free trial, once per workspace; included in every team plan): the public permit page (QR poster, email and website badges, recipients who get each renewal, who looked), the automatic permit check (every morning, report on the 1st) and 8 templates. Staff licenses: 3 people free, then ₱100 each a month to the 20th person, ₱60 to the 100th, ₱40 after; yearly is 10 months' price. Everything runs by itself (bills a week ahead, reminders, pausing and waking people, the check, renewal emails to recipients, worker reminders). The one thing that needs you: GCash/bank payments to confirm in Admin → Plus & staff (or Money → to-do), until online checkout is on. Give time to a customer from the same tab. Have a lawyer read the 8 templates once (Templates are general, not legal advice) and the "PermitPal Plus and staff licenses" section of the terms. Workspaces that already track more than 3 people get those people free for 30 days, with a heads-up.
8d. **White-label for accounting firms** (after `supabase/manual/2026-10-23-whitelabel.sql`): ₱1,000/month or ₱10,000/year on top of the Accounting firm plan (14-day free trial, once). The firm sets its name, logo, color, reply-to email, phone and tagline under Settings → Your brand. Its clients (connected or managed) then get reminder, tax-deadline, Monday-summary, nudge and invitation emails under the firm's name, see the firm's logo in their app, and get a report on the 1st. "Powered by PermitPal" stays on everything, clients keep their own free accounts, and the look switches back to PermitPal by itself when the add-on or the firm plan lapses or the firm disconnects (the client is told their account stays theirs). Optional: redeploy the `send-messages` function so emails also show the firm as the sender name and replies go to the firm; until then the emails carry the brand but come from your usual sender.
8e. **Yearly = 2 months free, everywhere** (after `supabase/manual/2026-10-24-yearly.sql`): a year of any team plan costs 10 months (₱19,900 for the firm plan), the same deal as Plus, staff licenses and White-label. The website and Settings → Plan show every plan with a checkmark list, a monthly/yearly switch (remembered per device), the daily and per-client cost, a 12-month strip with the 2 free months, and everything side by side. When you record a GCash/bank payment for 12 months in Admin, the amount fills in at 10 months' price.
8f. **Small property, firms vouching for themselves, American spelling** (after `supabase/manual/2026-10-25-small-property.sql`): Small property is ₱2,990/month (₱29,900/year) for up to 20 tenants; Mall & property stays ₱9,990 for any number. A property workspace picks either under Settings → Plan; inviting a 21st tenant on Small property asks them to move up, and a workspace with more than 20 tenants can't choose Small property. Firms applying to be listed must confirm they are registered and hold the licenses their work needs; PermitPal doesn't check papers, customers are told so, and there is no "checked" badge. Every message, bill name, template and permit note now says "license" and "color".
9. **Prices:** the website's home page sells the product; prices have their own page (`#/pricing`, linked as "Prices"). Team plan prices are ₱1,490 (Fleet), ₱1,990 (Accounting firm), ₱2,990 (Small property, up to 20 tenants, once database file 8 is in), ₱9,990 (Property). (The Head office plan is switched off and no longer offered.) Validate them on sales calls; ask Claude to change them.

**Legal:**
10. Terms and Privacy Policy are published (`web/terms.html`, `web/privacy.html`). Privacy requests come through the Contact PermitPal form (Admin → Inbox).
11. **Data Privacy Act:** you are the Data Protection Officer until you name someone else. Registering with the National Privacy Commission becomes required once you hold sensitive data (like staff license numbers) on 1,000 or more people, or have 250+ employees.

## Running tests

```bash
npm install
npm test            # rules + safety helpers
npm run test:ui     # full browser walk-through (uses a stand-in data layer)
```

Database tests: paste a file from `supabase/tests/` into the Supabase SQL editor. The error message it ends with lists PASS/FAIL for each check. Nothing is saved.

## Backups & data safety

- **Nothing a customer deletes is hard-deleted.** Businesses, vehicles, requirements, records and files go to **Trash** and can be restored. Only deleting a whole workspace erases data, after a 30-day grace period.
- **Every change is written to History by the database itself**: who, what, when, and the before/after values.
- **Nightly workflow:** encrypted copy of the database and every uploaded file. Supabase's own database backups do **not** include uploaded files, so this workflow is what protects them.
