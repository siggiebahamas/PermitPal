# Database smoke tests

These scripts create throwaway users and data, check the results, then **raise an
exception on purpose** so the whole transaction rolls back and nothing is kept.
The exception message carries the results (`PASS`/`FAIL` per step).

Run one by pasting it into the Supabase SQL editor (or applying it as a migration
that is expected to fail). A run is good when every line in the message says PASS.

| File | What it checks |
|---|---|
| `01_core_smoke.sql` | accounts, workspaces, starter checklists, status engine, renewals, History, isolation |
| `02_reminders_help_teams.sql` | reminders, help requests, invites, roles |
| `03_services_people_sharing.sql` | staff licenses, costs, share links, professionals and quote requests, staff reminders |
| `05_customer_isolation.sql` | one customer attacking another's data in every table; what visitors can read |
| `app_flows.sql` | every main app flow end to end, as two users and a visitor |
| `06_assign.sql` | giving permits to teammates, who gets reminders, escalation, people leaving |
| `07_library_orders.sql` | the permit library, renewal checklists, done-for-you orders from request to refund |
| `08_filings.sql` | tax and contribution deadlines, marking filed, reminders |
| `09_sms.sql` | verifying a mobile number, the checks every text passes |
| `10_two_step_login.sql` | workspaces that require two-step login, lost-phone resets |
| `11_revenue.sql` | rush fees, several permits at once, set-up access, package steps, Year-round care (bills, pauses, renewals it starts, the guarantee), fees from firms (leads, sales, listings, checklist lines, statements, applications), the staff ledger |
| `12_autorenew.sql` | Year-round care with no monthly fee (pay per renewal): no bill, renewals still start early, priced at the usual fee, never paused, no guarantee |
| `13_leads.sql` | Firms paid per quote request from prepaid credit (paused at zero), no per-sale fees, no website for customers, the firm's 7-day report link and staff decisions, "Did you hire them?" |
| `14_plus.sql` | Pinoy Permit Plus and staff licenses: prices, the free 3 people and paid licenses, bills (moving up with credit, moving down next period, renewals a week ahead, paying late, online checkout), pausing when a plan ends, the public permit page (statuses, hidden permits, copies, paused), recipients, the worker's upload link, licenses by role, the automatic permit check, templates, money views |
| `15_whitelabel.sql` | White-label for accounting firms: price, who can turn it on, the brand settings and logo files, the firm's look on clients' reminder, deadline, nudge, invitation and Monday emails, the client's app, the monthly client report, lapsing and disconnecting, money views |
| `16_yearly.sql` | Yearly team plans: 12 months cost 10 (2 months free), other lengths cost what they say, only the owner pays, a paid year runs 12 months |
| `17_small_property.sql` | Small property (up to 20 tenants, Plus and texts included, yearly price, can't be chosen with more than 20), firms confirming they're registered and licensed, "license" in bill names, permit notes, templates and messages |

Files 06 and later end with `rollback` and print a table instead: every row should say `ok = t`.

They can also run on a local Postgres with stand-ins for Supabase's `auth`, `storage`, `pg_cron` and `pg_net`.
