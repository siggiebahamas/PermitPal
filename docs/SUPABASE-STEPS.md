# Supabase: every step, in order (as of database file 17)

Do these on a computer, in your Pinoy Permit project (`zeaiwvgktakbwnqpchbo`). Never the Nifti project.
About 10 minutes. The website and the phone app update by themselves when code is pushed; these steps are only the
database and the calendar link, which have to be done in Supabase.

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

## Part C: see it working (1 minute)

15. Open Pinoy Permit and reload the page (on a phone: close the app and open it again).
16. On Home, tap **Google Calendar**. It should now say **Add to Google Calendar**. Tap it, Google asks
    "Add this calendar?", tap **Add**. Every deadline and to-do now shows in Google Calendar and stays up to date.
