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
