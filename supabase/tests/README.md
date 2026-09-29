# Database smoke tests

These scripts create throwaway users and data, check the results, then **raise an
exception on purpose** so the whole transaction rolls back and nothing is kept.
The exception message carries the results (`PASS`/`FAIL` per step).

Run one by pasting it into the Supabase SQL editor (or applying it as a migration
that is expected to fail). A run is good when every line in the message says PASS.
