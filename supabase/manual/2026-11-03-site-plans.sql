-- Database file 17 (plan names). Run once, in the Supabase SQL Editor, after file 16.
-- What it does:
--   * "Small property" is now called "Multi-Site" and "Mall & property" is "Multi-Site Unlimited", so the plans fit
--     landlords, franchisors and groups that look after many businesses. Same prices, same limits, same plan ids:
--     nobody's plan or payment changes.
--   * Messages from the database (like "covers up to 20") use the new names.
-- All or nothing: if anything fails, nothing is changed.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'lgus'), exists (select 1 from private.features where name = 'sites')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-11-02-brief.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== Plans for anyone who looks after many sites
-- "Small property" and "Mall & property" become "Multi-Site" and "Multi-Site Unlimited": the same plans, prices and
-- limits (20 sites; any number), named for landlords, franchisors and groups alike, not only buildings and malls.
-- Plan ids stay (property_s, property), so nothing about existing workspaces or payments changes.

update public.plans set name = 'Multi-Site' where id = 'property_s';
update public.plans set name = 'Multi-Site Unlimited' where id = 'property';
update public.plan_limits set name = 'Multi-Site' where code = 'property_s';
update public.plan_limits set name = 'Multi-Site Unlimited' where code = 'property';

-- The messages people see from the database ("Small property covers up to 20 …") use the new names too:
-- each function that mentions an old name is re-created from its own current text with the names swapped.
do $$
declare r record; v text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and p.prokind = 'f'
             and (p.prosrc like '%Small property%' or p.prosrc like '%Mall & property%') loop
    v := pg_get_functiondef(r.oid);
    v := replace(replace(v, 'Mall & property', 'Multi-Site Unlimited'), 'Small property', 'Multi-Site');
    execute v;
  end loop;
end $$;

insert into private.features (name) values ('sites') on conflict do nothing;

commit;
