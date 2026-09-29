# PermitPal

One place for every business permit and vehicle registration, with reminders before anything expires, and help renewing when you don't want to do it yourself.

- **Website:** static HTML/JS in `web/`, hosted on GitHub Pages (`https://siggiebahamas.github.io/PermitPal/`).
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

## Go-live checklist (things only you can do)

1. **Turn on the website.** GitHub → repo **Settings → Pages → Source: GitHub Actions**. The next push to `main` (or *Actions → Deploy website → Run*) publishes it.
2. **Point logins at the website.** Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://siggiebahamas.github.io/PermitPal/`
   - Add the same URL to Redirect URLs.
3. **Make sign-up emails work for real customers.** Supabase's built-in email only reaches your own team and is heavily rate-limited.
   1. Create a free [Resend](https://resend.com) account and verify a domain you own (for example `permitpal.ph`).
   2. In Supabase → **Authentication → Emails → SMTP Settings**, enter Resend's SMTP details.

   Until then, new customers can't confirm their accounts.
4. **Turn on reminder emails.** Supabase → **Edge Functions → Secrets**, add:
   - `RESEND_API_KEY`
   - `EMAIL_FROM`, for example `PermitPal <reminders@permitpal.ph>`
5. **Make yourself admin.** After you sign up, tell me (or run this in the SQL editor):
   `update public.profiles set is_platform_admin = true where email = 'YOUR EMAIL';`
   That unlocks the Admin page, where help requests arrive. They are also emailed to the address set in `private.settings.admin_notify_emails`.
6. **Backups.**
   1. Add these GitHub repo secrets: `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long `BACKUP_PASSPHRASE`. See the header of `.github/workflows/backup.yml`.
   2. Save the passphrase somewhere safe. Lose it and the backups can't be opened.
   3. Upgrade Supabase to **Pro** (about US$25/month) before real customers arrive. The free plan has no database backups and pauses after a quiet week; the keep-alive workflow covers the pause meanwhile.
7. **Payments (when you've set prices).**
   1. Set prices: `update public.plans set price_php_monthly = 499 where id = 'business';` (and `business_plus`).
   2. Add these Edge Function secrets:
      - `PAYMONGO_SECRET_KEY`
      - `PAYMONGO_WEBHOOK_SECRET`
      - `APP_URL` = the website URL
   3. In PayMongo, register the webhook `https://zeaiwvgktakbwnqpchbo.supabase.co/functions/v1/paymongo-webhook` for `checkout_session.payment.paid`.

   Until then, the plan cards say "Pricing coming soon". You can give pilot customers any plan from the Admin page.
8. **SMS / WhatsApp (optional, paid plans only).**
   - SMS: `SEMAPHORE_API_KEY` (and optionally `SEMAPHORE_SENDER`).
   - WhatsApp:
     1. Add `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`.
     2. Get a template named `permit_reminder` approved by Meta, with 4 body variables: first name, number of items, first item, link.

   Until a channel is connected, its messages are marked "skipped". They are never sent late in a flood.
9. **Have a lawyer review** `web/privacy.html` and `web/terms.html`. They are drafts.

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
