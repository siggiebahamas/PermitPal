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
| `03_services_people_sharing.sql` | staff licences, costs, share links, professionals and quote requests, staff reminders |
| `05_customer_isolation.sql` | one customer attacking another's data in every table; what visitors can read |
| `app_flows.sql` | every main app flow end to end, as two users and a visitor |

They can also run on a local Postgres with stand-ins for Supabase's `auth`, `storage`, `pg_cron` and `pg_net`.
