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

1. **Pages:** after the first deploy, check GitHub → Settings → Pages shows *Deploy from branch: gh-pages*. Set it once if it doesn't.
2. **Logins:** Supabase → Authentication → URL Configuration. Set Site URL to `https://siggiebahamas.github.io/PermitPal/` and add it to Redirect URLs.
3. **Emails (free):**
   1. Create a free [Resend](https://resend.com) account (3,000 emails/month) and verify a domain.
   2. Put its SMTP details in Supabase → Authentication → Emails → SMTP Settings. Until then, new customers can't confirm sign-up.
   3. Add the Edge Function secrets `RESEND_API_KEY` and `EMAIL_FROM`.
4. **Admin:** after you sign up, ask Claude to make your account admin. New service orders also email every admin account.
5. **Backups:** add the repo secrets `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `BACKUP_PASSPHRASE`. See `backup.yml`. Keep the passphrase safe.
6. **Legal:** have a lawyer review `web/privacy.html` and `web/terms.html`.
7. **Getting paid for services:** in the app, Admin → Payment details: fill in your GCash and bank details. Customers see these after accepting a quote.
8. **Online card/GCash checkout (optional):** add the Edge Function secrets `PAYMONGO_SECRET_KEY` and `APP_URL`, then set *online_payments* to `on` in Admin → Payment details.
9. **Data Privacy Act:** you are the Data Protection Officer until you name someone else. Set up a dedicated privacy email and add it to `web/privacy.html`. Registering with the National Privacy Commission becomes required once you hold sensitive data (like staff licence numbers) on 1,000 or more people, or have 250+ employees.
10. **Prices and partners:** review every price in Admin → Services & prices, and add your real partners (insurers, pest control, clinics) with their commission terms in Admin → Partners. The two sample partners exist only in the demo.

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
