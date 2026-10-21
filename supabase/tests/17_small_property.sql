-- Small property (up to 20 tenants), firms confirming they're registered and licensed, and "license"
-- spelled the American way. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated, anon;
create temp table t_ids (org uuid, big uuid); grant all on t_ids to authenticated, anon; insert into t_ids default values;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('a7000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lessor@small.ph','{"first_name":"Lea"}', now()),
 ('a7000000-0000-4000-8000-0000000000f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@small.ph','{"first_name":"Fely"}', now());
update public.profiles set is_platform_admin = true where id = 'a7000000-0000-4000-8000-0000000000f5';

select pg_temp.res('Small property: ₱2,990 a month, texts included, on sale',
  (select price_php_monthly = 2990 and paid_channels and available from public.plans where id = 'property_s'), '');

select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Lea''s Arcade'), big = public.create_org('Lea''s Mall');
update public.orgs set kind = 'property' where id in ((select org from t_ids), (select big from t_ids));
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
-- the trial is over; one pays for Small property, the other for Mall & property
update public.orgs set trial_ends_at = now() - interval '1 day', plan_id = 'property_s', plan_expires_at = now() + interval '20 days' where id = (select org from t_ids);
update public.orgs set trial_ends_at = now() - interval '1 day', plan_id = 'property', plan_expires_at = now() + interval '20 days' where id = (select big from t_ids);
select pg_temp.res('Small property opens the tenant board, with Plus and texts', private.has_team_tools(org) and private.has_plus(org)
  and private.tenant_cap(org) = 20 and private.tenant_cap(big) is null, '') from t_ids;
insert into public.org_links (owner_org, relation, invited_email, status, created_by)
  select org, 'tenant', 'tenant' || g || '@small.ph', 'pending', 'a7000000-0000-4000-8000-0000000000a1' from t_ids, generate_series(1, 20) g;
insert into public.org_links (owner_org, relation, invited_email, status, created_by)
  select big, 'tenant', 'tenant' || g || '@mall.ph', 'pending', 'a7000000-0000-4000-8000-0000000000a1' from t_ids, generate_series(1, 25) g;

select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('the 21st tenant needs Mall & property',
  pg_temp.err(format('select public.link_invite(%L, %L, %L)', org, 'tenant', 'new@small.ph')) like 'Your Small property plan covers 20 tenants.%', '') from t_ids;
select pg_temp.res('...but sending a waiting invitation again is fine', pg_temp.err(format('select public.link_invite(%L, %L, %L)', org, 'tenant', 'tenant3@small.ph')) = 'allowed', '') from t_ids;
select pg_temp.res('Mall & property has no limit', pg_temp.err(format('select public.link_invite(%L, %L, %L)', big, 'tenant', 'new@mall.ph')) = 'allowed', '') from t_ids;
select pg_temp.res('a year of Small property: ₱29,900 (2 months free)', (public.billing_start(org, 'property_s', 12) ->> 'amount_php')::numeric = 29900, '') from t_ids;
select pg_temp.res('with more than 20 tenants, Small property can''t be chosen',
  pg_temp.err(format('select public.billing_start(%L, %L, 1)', big, 'property_s')) like 'You have 26 tenants. Small property covers up to 20%', pg_temp.err(format('select public.billing_start(%L, %L, 1)', big, 'property_s'))) from t_ids;
select pg_temp.res('...by transfer either', pg_temp.err(format('select public.request_plan(%L, %L)', big, 'property_s')) like 'You have 26 tenants.%', '') from t_ids;
select pg_temp.res('Plus can''t be bought on top of Small property', pg_temp.err(format('select public.addon_preview(%L, %L, null, %L)', org, 'plus', 'monthly')) = 'Plus is already included in your team plan.', '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- firms confirm they're registered and licensed; PermitPal doesn't check
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('a firm must confirm it is registered and licensed',
  pg_temp.err($q$select public.apply_as_partner('Quick Permits', 'liaison', 'Pasig City', 'Ben', 'ben@quick.ph', '', '', 'Permits', '', '')$q$) = 'Please confirm your business is registered and holds the licenses its work needs.', '');
select public.apply_as_partner('Quick Permits', 'liaison', 'Pasig City', 'Ben', 'ben@quick.ph', '', 'DTI 1234567', 'Permits', '', '', null, true);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the confirmation is kept with the application', (select attested from public.partner_applications where email = 'ben@quick.ph'), '');
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000f5","role":"authenticated"}', true);
set local role authenticated;
select public.admin_application_to_partner((select id from public.partner_applications where email = 'ben@quick.ph'));
select pg_temp.res('...and on the listing made from it', (select verified and not published from public.partners where name = 'Quick Permits'), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- "license"
select pg_temp.res('bill names say "licenses"', private.addon_label('staff', 10, 'monthly') = 'Staff licenses, up to 10 people (monthly)', private.addon_label('staff', 10, 'monthly'));
select pg_temp.res('permit notes say "license"', (select validity_note like '%your license%' from public.requirement_types where code = 'fda_lto'), '');
select pg_temp.res('templates say "licenses"', not exists (select 1 from public.doc_templates where body ~* 'licence') and exists (select 1 from public.doc_templates where body ~ 'licenses'), '');
select pg_temp.res('no message says "license"', not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prokind = 'f' and pg_get_functiondef(p.oid) ~ '''[^'']* [Ll]icences? [^'']*'''), '');
select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'property_s'), '');

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
