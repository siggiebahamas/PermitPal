-- People (staff licenses), costs, sharing, professionals and quote requests, workspaces, reminders for staff.
-- (Done-for-you orders were retired in migration 20261007001100; their checks were removed.)
-- Always ends in an exception so nothing is kept; read PASS/FAIL from the message.

create temp table t_results (n serial, step text, ok boolean, detail text) on commit drop;
grant insert, select on t_results to authenticated, anon;
grant usage on sequence t_results_n_seq to authenticated, anon;
create temp table t_ids (org uuid, biz uuid, req uuid, ord uuid, ord2 uuid, person uuid, share text, partner uuid, ref uuid, other_org uuid) on commit drop;
grant all on t_ids to authenticated, anon;
insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at) values
  ('66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-000000000000','authenticated','authenticated','buyer@test.local','{"first_name":"Bea"}', now(), now(), now()),
  ('77777777-7777-7777-7777-777777777777','00000000-0000-0000-0000-000000000000','authenticated','authenticated','founder@test.local','{"first_name":"Fo"}', now(), now(), now()),
  ('88888888-8888-8888-8888-888888888888','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stranger@test.local','{"first_name":"St"}', now(), now(), now());
update public.profiles set is_platform_admin = true where id = '77777777-7777-7777-7777-777777777777';

-- ---------------------------------------------------------------- customer: data and a person
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Bea Trading');
update t_ids set biz = public.create_business(org, 'Bea Store', 'Sole Proprietorship', 'retail', 'Taguig City', '');
update t_ids set req = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit');
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on, amount_paid)
  select org, req, 'MP-1', private.today_ph() - 3, 4200 from t_ids;
insert into t_results (step, ok, detail) select 'cost is stored and shown in status view', amount_paid = 4200, amount_paid::text
  from public.requirement_status where id = (select req from t_ids);

update t_ids set person = public.create_person(org, 'Juan Driver', 'Driver', null, array['drivers_license','nbi_clearance']);
insert into t_results (step, ok, detail) select 'person gets the chosen licenses', count(*) = 2, string_agg(name, ', ')
  from public.requirement_status where person_id = (select person from t_ids);
insert into t_results (step, ok, detail) select 'person license shows the person''s name', bool_and(subject_name = 'Juan Driver' and subject = 'person'), string_agg(subject_name, ',')
  from public.requirement_status where person_id = (select person from t_ids);
select public.add_requirement('person', person, null, 'health_certificate') from t_ids;
insert into t_results (step, ok, detail) select 'add_requirement works for people', count(*) = 3, count(*)::text
  from public.requirements where person_id = (select person from t_ids) and deleted_at is null;

reset role;

-- ---------------------------------------------------------------- sharing
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
insert into public.compliance_shares (org_id, scope, subject_id, label) select org, 'business', biz, 'For our landlord' from t_ids;
update t_ids set share = (select token from public.compliance_shares where org_id = (select org from t_ids));
reset role;
set local role anon;
insert into t_results (step, ok, detail) select 'share link works without logging in', (j->>'org_name') = 'Bea Trading' and jsonb_array_length(j->'items') >= 4,
  (j->>'org_name') || ' ' || jsonb_array_length(j->'items') from (select public.get_shared_compliance((select share from t_ids)) j) x;
insert into t_results (step, ok, detail) select 'share link only covers that business', not exists (
  select 1 from jsonb_array_elements(public.get_shared_compliance((select share from t_ids))->'items') i where i->>'subject' <> 'business'), 'checked';
insert into t_results (step, ok, detail) select 'wrong token shows an error, not data', (public.get_shared_compliance('nope') ? 'error'), 'checked';
reset role;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
update public.compliance_shares set revoked_at = now() where token = (select share from t_ids);
reset role;
set local role anon;
insert into t_results (step, ok, detail) select 'revoked link stops working', (public.get_shared_compliance((select share from t_ids)) ? 'error'), 'checked';
reset role;

-- ---------------------------------------------------------------- partners and referrals
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
set local role authenticated;
insert into public.partners (category, name, offer, commission_terms, published) values ('insurance', 'Test Insurer', '10% off CTPL', '15% of premium', true);
update t_ids set partner = (select id from public.partners where name = 'Test Insurer');
reset role;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
insert into t_results (step, ok, detail) select 'customer sees published partner', count(*) = 1, count(*)::text from public.list_professionals() where name = 'Test Insurer';
insert into t_results (step, ok, detail) select 'customer cannot read commission terms', count(*) = 0, count(*)::text from public.partners;
update t_ids set ref = public.request_referral(org, partner, null, 'Need CTPL for 2 vans', 'phone', '0917');
insert into t_results (step, ok, detail) select 'referral recorded', count(*) = 1, count(*)::text from public.referrals where id = (select ref from t_ids);
insert into t_results (step, ok, detail) select 'customer cannot see commission', count(*) = 0, count(*)::text from public.referral_commissions;
reset role;
insert into t_results (step, ok, detail) select 'commission row ready for the founder', count(*) = 1, count(*)::text from public.referral_commissions where referral_id = (select ref from t_ids);

-- ---------------------------------------------------------------- service catalogue
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
update t_ids set other_org = public.create_org('Client Two');
-- (the multi-workspace summary was removed with the workspace switcher)
insert into t_results (step, ok, detail) select 'services visible', count(*) >= 15, count(*)::text from public.services;
reset role;
set local role anon;
insert into t_results (step, ok, detail) select 'services visible on the public page', count(*) >= 15, count(*)::text from public.services;
reset role;

-- ---------------------------------------------------------------- reminders include people
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
  select org, (select id from public.requirements where person_id = (select person from t_ids) and type_code = 'drivers_license'), 'N01-1', private.today_ph() + 6 from t_ids;
reset role;
select private.queue_due_reminders();
insert into t_results (step, ok, detail) select 'driver''s license reminder sent', count(*) = 1, string_agg(title || ' / ' || body, '; ')
  from public.notifications where user_id = '66666666-6666-6666-6666-666666666666' and title like 'Driver''s License%';

do $$ declare v text; begin
  select string_agg(case when ok then 'PASS ' else 'FAIL ' end || step || case when ok then '' else ' -> ' || coalesce(detail, '') end, E'\n' order by n)
    into v from t_results;
  raise exception E'TEST RESULTS (rolled back)\n%', v;
end $$;
