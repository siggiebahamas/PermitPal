# Turn on the one-tap Google Calendar button

Do this once. It takes about 5 minutes. Until you do, the "Google Calendar" button on Home gives customers a
one-time file instead.

**Before you start:** run database file 16 (see `docs/SUPABASE-STEPS.md`, which has every step in one place).

1. Open https://github.com/siggiebahamas/PermitPal/blob/main/supabase/functions/calendar-feed/index.ts
   and click the **Copy raw file** button (two overlapping squares, top right of the code).
2. Open your Supabase project (Pinoy Permit), and click **Edge Functions** in the left menu.
3. Click **Deploy a new function**, then **Via Editor**.
4. Delete the sample code in the editor and paste what you copied.
5. At the bottom, change the function name to exactly: `calendar-feed`
6. Click **Deploy function**. Wait for the green "deployed" message.
7. Click the **Details** tab of the new function. Turn **Enforce JWT verification** OFF, then click **Save changes**.
   (Calendar apps can't sign in; the private link is the key.)

**Check it:** open this in your browser:
https://zeaiwvgktakbwnqpchbo.supabase.co/functions/v1/calendar-feed?ping=1
It should show the word `ok`. If it says something about a JWT or "unauthorized", step 7 didn't save.

That's all. Reload Pinoy Permit: the Home "Google Calendar" button now shows **Add to Google Calendar**. Your customers
tap it, Google asks "Add this calendar?", they tap **Add**, and every deadline and to-do stays in their calendar.
