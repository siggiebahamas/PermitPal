-- Database file 19 (switch on the document vault). Run once, in the Supabase SQL Editor, after file 18, and only
-- after the doc-vault function is deployed with its DOC_VAULT_KEY secret (docs/SUPABASE-STEPS.md, Part B2).
-- From then on every file is encrypted before it is stored; with the vault on, uploads stop rather than store a file
-- unencrypted. Files already stored keep opening as before.
-- All or nothing: if anything fails, nothing is changed.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'vehicles2'), exists (select 1 from private.features where name = 'vault')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-11-04-vehicles-templates.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

insert into private.features (name) values ('vault') on conflict do nothing;

commit;
