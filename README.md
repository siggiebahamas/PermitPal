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
0. **Database changes waiting:** in Supabase → SQL Editor, run `supabase/manual/2026-10-17-new-features.sql`, then `supabase/manual/2026-10-19-revenue.sql`, then `supabase/manual/2026-10-20-autorenew.sql` (each once, in that order; each is all-or-nothing and refuses to run twice). Until then the site hides every feature they add.
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
8. **Professionals:** add real liaison firms and accountants in Admin → Professionals (their email receives quote requests), or approve the ones that apply on the "For service providers" page. Tick "Licence checked" only after seeing their business permit and licence. Choose how each firm pays (per quote request, per sale, flat monthly, or free), add checklist lines if they pay for one, and send monthly statements from Admin → Partner billing. Insurers: per-request or per-sale fees are blocked until your Insurance Commission licence number is saved (Insurance Code, Sec. 307). The sample firms exist only in the demo.
8b. **Year-round care and the on-time guarantee:** prices, and the list of permits each plan renews, are in Admin → Care. Two ways to pay (after `supabase/manual/2026-10-20-autorenew.sql`): Pay per renewal, ₱0 a month, where each renewal care starts is quoted at the service's usual price; and the All-in plan, ₱1,200/month or ₱12,000/year per branch and ₱250/month or ₱2,500/year per vehicle, with every covered renewal included and the on-time guarantee. Keep the Pay per renewal tiers at ₱0. One-time renewals from ₱1,500 (Mayor's Permit ₱6,000, FSIC ₱3,000, LTO ₱2,000). Licences outside a plan's list (FDA, DOH, franchises, contractor licences, permits customers add themselves) are quoted as one-time jobs. Have a lawyer read the "Year-round care" and "On-time guarantee" sections of the terms before the first sale; the guarantee is written as a service guarantee for your own misses, not insurance.
9. **Prices:** team plan prices are ₱1,490 (Fleet), ₱1,990 (Accounting firm), ₱9,990 (Property). (The Head office plan is switched off and no longer offered.) Validate them on sales calls; ask Claude to change them.

**Legal:**
10. Terms and Privacy Policy are published (`web/terms.html`, `web/privacy.html`). Privacy requests come through the Contact PermitPal form (Admin → Inbox).
11. **Data Privacy Act:** you are the Data Protection Officer until you name someone else. Registering with the National Privacy Commission becomes required once you hold sensitive data (like staff licence numbers) on 1,000 or more people, or have 250+ employees.

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
