# Going live: every step, in order (as of database file 20)

Do these on a computer, in your Pinoy Permit project (`zeaiwvgktakbwnqpchbo`). Never the Nifti project.
The website and the phone app update by themselves when code is pushed (about 10 minutes). Everything below has to be
done by you, once, in Supabase, Resend or GitHub. Parts A–E are needed before real customers; Part F is optional.

## Part A: the database (5 minutes)

1. Go to https://supabase.com/dashboard/project/zeaiwvgktakbwnqpchbo/sql/new
   (it opens the SQL Editor of the right project with an empty query).
2. Paste this line, then click **Run** (bottom right):
   ```sql
   select name from private.features order by name;
   ```
3. Look at the list that appears under the editor, and start at the first file that's missing:
   | If the list does NOT have | run this file |
   |---|---|
   | `prices2` | `2026-11-01-prices-and-delivery.sql` (file 15) |
   | `lgus` | `2026-11-02-brief.sql` (file 16) |
   | `sites` | `2026-11-03-site-plans.sql` (file 17) |
   | `vehicles2` | `2026-11-04-vehicles-templates.sql` (file 18) |
   | `fileguard` | `2026-11-06-file-access.sql` (file 20: "Ask me first" for files, and who opened what) |

   File 19 (`vault`) comes later, in Part B2: it needs the encryption function first.
   Everything there already → go to Part B.
4. To run a file: open it on GitHub at https://github.com/siggiebahamas/PermitPal/tree/main/supabase/manual ,
   click its name, then click the **Copy raw file** button (two small squares, top right of the code).
5. Back in the SQL Editor: click **New query** (or select everything in the editor and delete it), paste, click **Run**.
6. Wait until it says **Success. No rows returned**. Then do the next missing file the same way (always in the order
   of the table). If it shows a message starting with "Run …" or "This file was already run", nothing was changed;
   do what it says.

## Part B: the one-tap Google Calendar button (5 minutes)

7. Open https://github.com/siggiebahamas/PermitPal/blob/main/supabase/functions/calendar-feed/index.ts
   and click **Copy raw file**.
8. Go to https://supabase.com/dashboard/project/zeaiwvgktakbwnqpchbo/functions
9. Click **Deploy a new function**, then **Via Editor**.
10. Delete all the sample code in the editor, and paste.
11. At the bottom, change the function name to exactly: `calendar-feed`
12. Click **Deploy function**. Wait for the green "deployed" message.
13. Click the **Details** tab of the function. Turn **Enforce JWT verification** OFF. Click **Save changes**.
    (Calendar apps can't sign in; the private link is the key.)
14. Check it: open https://zeaiwvgktakbwnqpchbo.supabase.co/functions/v1/calendar-feed?ping=1
    - It shows **ok** → done.
    - It mentions JWT or "unauthorized" → step 13 didn't save; do it again.

15. Reload Pinoy Permit (on a phone: close the app and open it again). On Home, tap **Google Calendar**: it should say
    **Add to Google Calendar**.

## Part B2: lock every file with encryption (10 minutes) — do this before real customers upload anything

Files are already private. This adds a second lock: each file is encrypted (AES-256) before it is stored, with a key
that lives only in one function's settings. A copy of the storage or a backup is unreadable without that key.

1. Make your key. In the SQL Editor (as in Part A), paste this and click **Run**:
   ```sql
   select encode(extensions.gen_random_bytes(32), 'base64') as your_vault_key;
   ```
   Copy the long text it shows. **Save it in your password manager now.** Without it, encrypted files can never be
   opened again, not even by us, and backups can't be restored. Never paste it in a chat, an email or GitHub.
2. Supabase → https://supabase.com/dashboard/project/zeaiwvgktakbwnqpchbo/functions/secrets → **Add new secret**:
   name `DOC_VAULT_KEY`, value = the text from step 1. Save.
3. Open https://github.com/siggiebahamas/PermitPal/blob/main/supabase/functions/doc-vault/index.ts and click **Copy raw file**.
4. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**. Delete the sample code, paste, name it
   exactly `doc-vault`, click **Deploy function**.
5. Its **Details** tab: turn **Enforce JWT verification** OFF, **Save changes**. (Storage's own rules still check every
   file; the public permit page and workers' upload links have no login.)
6. Check it: open https://zeaiwvgktakbwnqpchbo.supabase.co/functions/v1/doc-vault?ping=1
   - `{"ok":true,"vault":true}` → good.
   - `"vault":false` → the secret in step 2 is missing or misnamed.
7. Now run database file 19 the same way as in Part A: `2026-11-05-vault-on.sql`. From then on every new file is
   encrypted; files uploaded before keep opening as before. Settings → **Your data** then says **Your files are locked**.

If you ever need a new key (for example, you think it leaked): keep the old one, add a secret `DOC_VAULT_OLD_KEYS` with
the value `1:<old key>`, set `DOC_VAULT_KEY` to the new one and `DOC_VAULT_KEY_ID` to `2`. Old files still open; new
ones use the new key.

## Part C: email, so reminders and sign-up emails actually go out (20 minutes, free)

Without this, nobody gets reminder emails and new customers can't confirm their sign-up.

16. Buy a domain, e.g. at https://dash.cloudflare.com (Domain Registration; a `.com` is about US$10 a year).
    Tell Claude the domain and it will point the website at it too.
17. Make a free account at https://resend.com. Click **Domains** → **Add domain**, type your domain, and copy the
    records it shows into your domain's DNS (in Cloudflare: your domain → **DNS** → **Add record**). Wait until Resend
    says **Verified**.
18. In Resend: **API Keys** → **Create API key**. Copy it (it starts with `re_`).
19. Supabase → https://supabase.com/dashboard/project/zeaiwvgktakbwnqpchbo/functions/secrets → add two secrets:
    - `RESEND_API_KEY` = the key from step 18
    - `EMAIL_FROM` = `Pinoy Permit <reminders@YOURDOMAIN.com>`
20. Supabase → **Authentication** → **Emails** → **SMTP Settings** → turn on **Custom SMTP** and fill in:
    host `smtp.resend.com`, port `465`, username `resend`, password = the key from step 18,
    sender email `hello@YOURDOMAIN.com`, sender name `Pinoy Permit`. Save.
21. After Part D (you need to be admin): in Pinoy Permit, **Admin** → **Messages** → **Send me a test email**. It should arrive within a minute.

## Part D: logins (2 minutes)

22. Supabase → **Authentication** → **URL Configuration**. Set **Site URL** to `https://siggiebahamas.github.io/PermitPal/`
    (or your own domain once Claude has pointed it), and add the same address under **Redirect URLs**. Save.
23. Make your email the only admin email. In the SQL Editor (as in Part A), paste this with your own email, then **Run**:
    ```sql
    update private.settings set value = 'YOUR@EMAIL.com' where key = 'admin_notify_emails';
    ```
24. Sign up in Pinoy Permit with that same email and confirm it. That account becomes admin (staff) automatically.
    Nobody else can: customers can't give themselves admin, and only an email on that one list gets it.

**Check who has admin access (anytime):** paste this in the SQL Editor and click **Run**:
```sql
select u.email, u.created_at from public.profiles p join auth.users u on u.id = p.id where p.is_platform_admin;
select value as admin_emails from private.settings where key = 'admin_notify_emails';
```
The first list should show only you; the second only your email.
To take admin away from someone: `update public.profiles set is_platform_admin = false where id = (select id from auth.users where email = 'THEIR@EMAIL.com');`

## Part E: nightly backups (5 minutes)

25. GitHub → https://github.com/siggiebahamas/PermitPal/settings/secrets/actions → **New repository secret**, four times:
    - `SUPABASE_DB_URL`: Supabase → **Connect** → **Session pooler** string, with your database password in it
    - `SUPABASE_URL`: `https://zeaiwvgktakbwnqpchbo.supabase.co`
    - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → **Project Settings** → **API Keys** → the secret key
    - `BACKUP_PASSPHRASE`: any long phrase you make up. Keep it in a password manager: backups can't be opened without it.
26. GitHub → **Actions** → **Nightly backup** → **Run workflow**. It should finish green.
    Backups hold files the way storage holds them: encrypted, once Part B2 is done. To restore files from a backup you
    also need your vault key from Part B2, so keep both the passphrase and the key in your password manager.

## Part F (optional, costs money): WhatsApp reminders

WhatsApp reminders are already built; they switch on when these are added. They are **not free**: Meta charges per
reminder (rates by country at https://developers.facebook.com/docs/whatsapp/pricing) and needs your business verified.
Viber is not built: it costs at least about €100 a month before any messages.

27. Make a Meta Business account and verify your business (DTI/SEC papers), then set up WhatsApp at
    https://developers.facebook.com/apps → **Create app** → **Business** → add **WhatsApp**.
28. Create a message template named `permit_reminder` (category **Utility**, language **English**) with this text, and
    submit it for approval:
    `Hi {{1}}, you have {{2}} permit deadline(s) coming up, starting with {{3}}. See them here: {{4}}`
29. Supabase → Edge Functions → Secrets → add `WHATSAPP_TOKEN` (a permanent access token) and `WHATSAPP_PHONE_ID`
    (from WhatsApp → API Setup).
30. Tell Claude it's on, so the "WhatsApp reminders" switch can be shown in Settings.
