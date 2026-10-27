# Supabase: everything to run by hand (as of database file 16)

All in your Pinoy Permit project (`zeaiwvgktakbwnqpchbo`). About 10 minutes.

## 1. See what's already in (30 seconds)

Supabase → **SQL Editor** → **New query** → paste and **Run**:

```sql
select name from private.features order by name;
```

- `lgus` is in the list → the database is up to date. Skip to step 3.
- `prices2` is in the list but `lgus` isn't → do step 2.
- `prices2` isn't there either → run `supabase/manual/2026-11-01-prices-and-delivery.sql` first (same way as step 2), then step 2.

## 2. Run database file 16

1. Open https://github.com/siggiebahamas/PermitPal/blob/main/supabase/manual/2026-11-02-brief.sql and click **Copy raw file**.
2. SQL Editor → **New query** → paste → **Run**.
3. You should see **Success. No rows returned**. If it says "Run … first" or "already run", nothing was changed: follow what it says.

This turns on: the Home to-dos, the private calendar link, the 17-city register, online-only bill pay, plans by size and
the new template prices.

## 3. Turn on the one-tap Google Calendar button

1. Open https://github.com/siggiebahamas/PermitPal/blob/main/supabase/functions/calendar-feed/index.ts and click **Copy raw file**.
2. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
3. Delete the sample code and paste.
4. At the bottom, name it exactly `calendar-feed`, then **Deploy function**. Wait for "deployed".
5. Open the function's **Details** tab, turn **Enforce JWT verification** OFF, and click **Save changes**.
   (Calendar apps can't sign in; the private link is the key.)

**Check:** open https://zeaiwvgktakbwnqpchbo.supabase.co/functions/v1/calendar-feed?ping=1. It should say `ok`.
If it mentions JWT or "unauthorized", step 5 didn't save.

## 4. Done

Reload Pinoy Permit. On Home, **Google Calendar** now shows **Add to Google Calendar**: customers tap it, Google asks
"Add this calendar?", they tap **Add**, and every deadline and to-do stays in their calendar.
