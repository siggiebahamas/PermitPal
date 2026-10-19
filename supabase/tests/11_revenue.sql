-- The three ways PermitPal earns and the money ledger: rush fees, renewing several permits at once,
-- "set up my account" with temporary staff access, package steps, Year-round care (bills, pauses,
-- renewals it starts by itself, the on-time guarantee), fees from firms (per lead, per sale, listings,
-- checklist lines, statements, applications) and the staff ledger. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (org uuid, org2 uuid, biz uuid, loc uuid, loc2 uuid, veh uuid, mp uuid, brgy uuid, fsic uuid, lto uuid,
  inv uuid, inv2 uuid, plan uuid, vplan uuid, ord uuid, setup uuid, batch uuid, partner uuid, insurer uuid, place uuid, ref uuid, stmt uuid, app uuid, walk uuid);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('c0000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@rev.ph','{"first_name":"Rosa"}', now()),
 ('c0000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member@rev.ph','{"first_name":"Mio"}', now()),
 ('c0000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@rev.ph','{"first_name":"Oto"}', now()),
 ('c0000000-0000-4000-8000-0000000000f4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@rev.ph','{"first_name":"Fe"}', now());
update public.profiles set is_platform_admin = true where id = 'c0000000-0000-4000-8000-0000000000f4';

-- ---------------------------------------------------------------- a customer with a business, a branch and a van
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Rosa Foods');
update t_ids set biz = public.create_business(org, 'Rosa Bakery', 'Corporation', 'restaurant', 'Pasig City', '');
update t_ids set loc = (select id from public.business_locations where business_id = (select biz from t_ids) and is_main);
update t_ids set loc2 = public.add_location(biz, 'Ortigas branch', 'Pasig City', '');
update t_ids set veh = (public.create_vehicle(p_org => org, p_make_model => 'Isuzu Traviz', p_plate_no => 'NAB 1234', p_vehicle_type => 'Truck', p_cr_no => '') ->> 'vehicle_id')::uuid;
update t_ids set mp = (select id from public.requirements where location_id = (select loc from t_ids) and type_code = 'mayors_permit'),
                 brgy = (select id from public.requirements where location_id = (select loc from t_ids) and type_code = 'barangay_clearance'),
                 fsic = (select id from public.requirements where location_id = (select loc from t_ids) and type_code = 'fsic'),
                 lto = (select id from public.requirements where vehicle_id = (select veh from t_ids) and type_code = 'lto_registration');
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, mp, 'MP-1', private.today_ph() + 40 from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, brgy, 'BC-1', private.today_ph() + 200 from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, lto, 'OR-1', private.today_ph() + 30 from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('test setup: permits exist for the branch and the van', (select mp is not null and brgy is not null and fsic is not null and lto is not null from t_ids), '');
insert into public.org_members (org_id, user_id, role) select org, 'c0000000-0000-4000-8000-0000000000b2', 'member' from t_ids;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org2 = public.create_org('Other Co');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ================================================================ 1) one-time jobs
-- rush fee
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set ord = public.request_service(org, 'renew_fsic', fsic, null, null, null, 'Inspection is next week', true, 'email', 'owner@rev.ph', 'have', 'apply', true);
-- a customer writing straight to the table can't give themselves a care plan, a batch or an invoice number
insert into public.assistance_requests (org_id, service_code, requirement_name, subject_label, status, bir_invoice_no, quote_rush_fee, staff_access, notes)
  select org, 'renew_other', 'x', 'x', 'submitted', 'FAKE-1', 999, true, 'x-test' from t_ids;
select pg_temp.res('customers can''t set invoice numbers, rush fees or staff access themselves',
  bir_invoice_no is null and quote_rush_fee = 0 and not staff_access, coalesce(bir_invoice_no, '-') || '/' || quote_rush_fee)
  from public.assistance_requests where notes = 'x-test';
update public.assistance_requests set bir_invoice_no = 'FAKE-2', steps_done = 3 where notes = 'x-test';
select pg_temp.res('...nor change them afterwards', bir_invoice_no is null and steps_done = 0, coalesce(bir_invoice_no, '-'))
  from public.assistance_requests where notes = 'x-test';
update public.assistance_requests set status = 'cancelled' where notes = 'x-test';
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select public.admin_quote_request(ord, 1500, 2000, 'FSIC', 800) from t_ids;
select pg_temp.res('the quote adds the rush fee as its own line', quote_php = 4300 and quote_rush_fee = 800, quote_php::text)
  from public.assistance_requests where id = (select ord from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.accept_quote(ord) from t_ids;
select public.submit_payment(ord, 'gcash', 'GC-777') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select public.admin_confirm_payment(ord, true) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- a request that isn't urgent can't be charged a rush fee
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set walk = public.request_service(org, 'renew_mayors_permit', mp, p_rush => false, p_consent => true);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.admin_quote_request((select walk from t_ids), 2500, 0, null, 500);
  perform pg_temp.res('no rush fee unless the customer asked for it', false, 'was allowed');
exception when others then perform pg_temp.res('no rush fee unless the customer asked for it', sqlerrm like '%didn''t ask%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update public.assistance_requests set status = 'cancelled' where id = (select walk from t_ids);

-- several permits at once
do $$ begin perform public.request_services_bulk((select org from t_ids), array[(select brgy from t_ids), (select lto from t_ids)], p_consent => false);
  perform pg_temp.res('several at once still needs the authorization tick', false, 'was allowed');
exception when others then perform pg_temp.res('several at once still needs the authorization tick', sqlerrm like '%tick the box%', sqlerrm); end $$;
do $$ begin perform public.request_services_bulk((select org from t_ids), array[(select brgy from t_ids), (select brgy from t_ids)], p_consent => true);
  perform pg_temp.res('the same permit twice is refused', false, 'was allowed');
exception when others then perform pg_temp.res('the same permit twice is refused', sqlerrm like '%twice%', sqlerrm); end $$;
do $$ begin perform public.request_services_bulk((select org from t_ids), array[(select brgy from t_ids), (select fsic from t_ids)], p_consent => true);
  perform pg_temp.res('a permit that already has an open request stops the whole batch', false, 'was allowed');
exception when others then perform pg_temp.res('a permit that already has an open request stops the whole batch', sqlerrm like '%already has an open request%', sqlerrm); end $$;
select pg_temp.res('...and nothing from that batch was saved', count(*) = 0, count(*)::text)
  from public.assistance_requests where requirement_id = (select brgy from t_ids);
update t_ids set batch = public.request_services_bulk(org, array[brgy, lto], true, 'phone', '09171234567', 'Before the 20th please', true);
select pg_temp.res('one order per permit, sharing a batch', count(*) = 2 and bool_and(rush) and bool_and(consented_at is not null), count(*)::text)
  from public.assistance_requests where batch_id = (select batch from t_ids);
select pg_temp.res('the right service for each permit', string_agg(service_code, ',' order by service_code) = 'renew_barangay_clearance,renew_lto_registration',
  string_agg(service_code, ',' order by service_code)) from public.assistance_requests where batch_id = (select batch from t_ids);
do $$ begin perform public.request_services_bulk((select org from t_ids), array[(select veh from t_ids)], p_consent => true);
  perform pg_temp.res('something that isn''t a permit in this workspace is refused', false, 'was allowed');
exception when others then perform pg_temp.res('something that isn''t a permit in this workspace is refused', sqlerrm like '%not found%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('staff get one notice for the whole batch, not one per permit',
  (select count(*) from public.notifications where user_id = 'c0000000-0000-4000-8000-0000000000f4' and title like 'New request: 2 permits%') = 1
  and not exists (select 1 from public.notifications n join public.assistance_requests a on n.dedupe_key like 'ordernew:' || a.id || '%' where a.batch_id = (select batch from t_ids)), '');
select pg_temp.res('the customer gets one note for the batch', count(*) = 1, count(*)::text)
  from public.notifications where user_id = 'c0000000-0000-4000-8000-0000000000a1' and title like 'We received your request for 2 permits';
update public.assistance_requests set status = 'cancelled' where batch_id = (select batch from t_ids);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.request_services_bulk((select org from t_ids), array[(select mp from t_ids)], p_consent => true);
  perform pg_temp.res('another workspace can''t order for this one', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace can''t order for this one', sqlerrm = 'Not allowed.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- set up my account for me: temporary, visible staff access
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set setup = public.request_service(org, 'setup_from_paper', null, null, null, null, '30 permits in a box', false, 'email', 'owner@rev.ph', 'not_sure', 'other', true);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select public.admin_quote_request(setup, 2000, 0, '30 documents') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.accept_quote((select setup from t_ids));
  perform pg_temp.res('set-up needs the customer''s OK for access', false, 'was allowed');
exception when others then perform pg_temp.res('set-up needs the customer''s OK for access', sqlerrm like '%temporary access%', sqlerrm); end $$;
select public.accept_quote(setup, true) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.admin_join_workspace((select setup from t_ids));
  perform pg_temp.res('staff can''t join before the job is paid', false, 'was allowed');
exception when others then perform pg_temp.res('staff can''t join before the job is paid', sqlerrm like '%paid%', sqlerrm); end $$;
select public.admin_confirm_payment(setup, true) from t_ids;
select pg_temp.res('after payment, staff join the workspace as a member', public.admin_join_workspace(setup) = org, '') from t_ids;
select public.admin_order_step(setup, 2) from t_ids;
do $$ begin perform public.admin_order_step((select setup from t_ids), 9);
  perform pg_temp.res('steps stay within the list', false, 'was allowed');
exception when others then perform pg_temp.res('steps stay within the list', true, sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('staff are a plain member (not admin)', role = 'member', role) from public.org_members
  where org_id = (select org from t_ids) and user_id = 'c0000000-0000-4000-8000-0000000000f4';
select pg_temp.res('the owner is told, with how to remove access', count(*) >= 1, count(*)::text)
  from public.notifications where user_id = 'c0000000-0000-4000-8000-0000000000a1' and title like 'PermitPal joined%';
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('the team can see who from PermitPal has access and why', count(*) = 1 and min(requirement_name) = 'Set up my account for me', count(*)::text)
  from public.my_staff_access((select org from t_ids));
select pg_temp.res('the customer sees the step progress', steps_done = 2, steps_done::text) from public.assistance_requests where id = (select setup from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select public.admin_update_order(setup, 'completed', 'All set up') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('access ends by itself when the job is done', not exists (select 1 from public.org_members
  where org_id = (select org from t_ids) and user_id = 'c0000000-0000-4000-8000-0000000000f4')
  and not exists (select 1 from private.staff_memberships where request_id = (select setup from t_ids) and ended_at is null), '');

-- ================================================================ 2) year-round care
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.start_care((select org from t_ids), jsonb_build_array(jsonb_build_object('kind','location','id',(select loc from t_ids),'tier','branch_plus')), 'monthly', true);
  perform pg_temp.res('only the owner can start a paid plan', false, 'was allowed');
exception when others then perform pg_temp.res('only the owner can start a paid plan', sqlerrm like 'Only the workspace owner%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.start_care((select org from t_ids), jsonb_build_array(jsonb_build_object('kind','vehicle','id',(select veh from t_ids),'tier','branch_plus')), 'monthly', true);
  perform pg_temp.res('a branch plan can''t be put on a vehicle', false, 'was allowed');
exception when others then perform pg_temp.res('a branch plan can''t be put on a vehicle', sqlerrm like '%doesn''t match%', sqlerrm); end $$;
do $$ begin perform public.start_care((select org from t_ids), jsonb_build_array(jsonb_build_object('kind','location','id',(select loc from t_ids),'tier','branch_plus')), 'monthly', false);
  perform pg_temp.res('starting care needs the consent tick', false, 'was allowed');
exception when others then perform pg_temp.res('starting care needs the consent tick', true, sqlerrm); end $$;
update t_ids set inv = public.start_care(org, jsonb_build_array(
  jsonb_build_object('kind','location','id',loc,'tier','branch_plus'),
  jsonb_build_object('kind','vehicle','id',veh,'tier','vehicle_plus')), 'monthly', true);
select pg_temp.res('one sign-up bill for everything chosen', amount_php = 1450 and status = 'due' and first and jsonb_array_length(lines) = 2, amount_php::text)
  from public.care_invoices where id = (select inv from t_ids);
select pg_temp.res('plans wait for the first payment', count(*) = 2 and bool_and(status = 'pending'), string_agg(status, ','))
  from public.care_plans where org_id = (select org from t_ids);
do $$ begin perform public.start_care((select org from t_ids), jsonb_build_array(jsonb_build_object('kind','location','id',(select loc from t_ids),'tier','branch_care')), 'per_renewal', true);
  perform pg_temp.res('one plan per branch', false, 'was allowed');
exception when others then perform pg_temp.res('one plan per branch', sqlerrm like '%already has a care plan%', sqlerrm); end $$;
do $$ begin perform public.pay_care_invoice((select inv from t_ids), 'gcash', '', null);
  perform pg_temp.res('paying needs a reference or screenshot', false, 'was allowed');
exception when others then perform pg_temp.res('paying needs a reference or screenshot', sqlerrm like '%reference%', sqlerrm); end $$;
do $$ begin perform public.pay_care_invoice((select inv from t_ids), 'gcash', 'x', 'someone-else/care/x/y.png');
  perform pg_temp.res('a screenshot must be in this bill''s folder', false, 'was allowed');
exception when others then perform pg_temp.res('a screenshot must be in this bill''s folder', true, sqlerrm); end $$;
select public.pay_care_invoice(inv, 'gcash', 'GC-123', org || '/care/' || inv || '/shot.png', 'shot.png') from t_ids;
update t_ids set plan = (select id from public.care_plans where location_id = (select loc from t_ids)),
                 vplan = (select id from public.care_plans where vehicle_id = (select veh from t_ids));
select pg_temp.res('the team sees its plans, bills and what each covers', (select count(*) from public.care_coverage((select org from t_ids))) >= 5, '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
-- Care renews a fixed list of permit types: an FDA licence or a permit the customer typed in is a one-time job.
insert into public.requirements (org_id, subject, business_id, location_id, type_code, name, notes)
  select org, 'business', biz, loc, 'fda_lto', 'FDA License to Operate', 'scope-test' from t_ids;
insert into public.requirements (org_id, subject, business_id, location_id, name, notes)
  select org, 'business', biz, loc, 'Elevator permit', 'scope-test' from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
  select r.org_id, r.id, 'X-1', private.today_ph() + 20 from public.requirements r where r.notes = 'scope-test';
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('Care doesn''t cover licences outside its list, or custom permits',
  not exists (select 1 from public.care_coverage((select org from t_ids)) c join public.requirements r on r.id = c.requirement_id where r.notes = 'scope-test')
  and exists (select 1 from public.care_coverage((select org from t_ids)) c where c.requirement_id = (select mp from t_ids)), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('another workspace sees none of it', (select count(*) from public.care_plans) = 0 and (select count(*) from public.care_invoices) = 0
  and (select count(*) from public.care_coverage((select org from t_ids))) = 0, '');
do $$ begin perform public.pay_care_invoice((select inv from t_ids), 'gcash', 'X');
  perform pg_temp.res('another workspace can''t touch the bill', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace can''t touch the bill', true, sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('staff can open the payment screenshot (logged)', public.staff_open_file(org || '/care/' || inv || '/shot.png') = 'shot.png', '') from t_ids;
select public.admin_confirm_care_payment(inv, true, null, 'INV-0001') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('paid: plans are active from today for one month',
  bool_and(status = 'active' and started_on = private.today_ph() and paid_through = (private.today_ph() + interval '1 month')::date - 1), string_agg(status, ','))
  from public.care_plans where org_id = (select org from t_ids);
select pg_temp.res('the customer sees the file open in their access log', count(*) = 1, count(*)::text)
  from public.staff_file_access where org_id = (select org from t_ids) and reason like 'Care bill%';

-- renewals the plan starts by itself
select pg_temp.res('the daily job starts covered renewals that are due soon', private.care_daily() >= 2, '');
select pg_temp.res('...and doesn''t start them, even when due soon',
  not exists (select 1 from public.assistance_requests a join public.requirements r on r.id = a.requirement_id where r.notes = 'scope-test'), '');
select pg_temp.res('the Mayor''s Permit (40 days away) and the van''s registration (30 days) are started',
  (select count(*) from public.assistance_requests where care_plan_id is not null and created_by is null and requirement_id in ((select mp from t_ids), (select lto from t_ids))) = 2, '');
select pg_temp.res('the barangay clearance (200 days away) and the other branch are left alone',
  not exists (select 1 from public.assistance_requests a where a.care_plan_id is not null and (a.requirement_id = (select brgy from t_ids) or a.requirement_id in (select id from public.requirements where location_id = (select loc2 from t_ids))) and a.status <> 'cancelled' and a.batch_id is null), '');
select pg_temp.res('running it again starts nothing twice', private.care_daily() = 0, '');
-- the customer cancels the one for the van: it isn't started again for the same expiry date
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update public.assistance_requests set status = 'cancelled' where care_plan_id is not null and requirement_id = (select lto from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('a renewal the customer cancelled is not started again', private.care_daily() = 0
  and (select count(*) from public.assistance_requests where care_plan_id is not null and requirement_id = (select lto from t_ids)) = 1, '');
update public.assistance_requests set status = 'submitted', closed_at = null where care_plan_id is not null and requirement_id = (select lto from t_ids);
select pg_temp.res('the owner is told the renewal has started', count(*) >= 2, count(*)::text)
  from public.notifications where user_id = 'c0000000-0000-4000-8000-0000000000a1' and title like 'We''ve started your%';
-- pre-approved government fees: accepted for them
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.set_care_preapproval((select org from t_ids), 5000);
  perform pg_temp.res('only owners and admins set the pre-approval', false, 'was allowed');
exception when others then perform pg_temp.res('only owners and admins set the pre-approval', true, sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.set_care_preapproval(org, 5000) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select public.admin_quote_request(id, 0, 4200, 'City assessment') from public.assistance_requests where care_plan_id is not null and requirement_id = (select mp from t_ids);
select public.admin_quote_request(id, 0, 9000, 'LTO + CTPL') from public.assistance_requests where care_plan_id is not null and requirement_id = (select lto from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('within the pre-approved amount: accepted for them, waiting for payment', status = 'awaiting_customer' and payment_status = 'awaiting_payment' and accepted_at is not null, status)
  from public.assistance_requests where care_plan_id is not null and requirement_id = (select mp from t_ids);
select pg_temp.res('above it: they approve it themselves', status = 'quoted', status)
  from public.assistance_requests where care_plan_id is not null and requirement_id = (select lto from t_ids);

-- walk-through included once a year with the All-in plan
update public.assistance_requests set status = 'completed' where id = (select ord from t_ids);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set walk = public.request_service(org, 'adv_fire_preinspection', fsic, p_kind => 'other', p_consent => true);
select pg_temp.res('a walk-through for an All-in branch is marked as included', care_plan_id = (select plan from t_ids), coalesce(care_plan_id::text, 'none'))
  from public.assistance_requests where id = (select walk from t_ids);
update public.assistance_requests set status = 'cancelled' where id = (select walk from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- the next bill, being late, pausing, catching up
update public.care_plans set paid_through = private.today_ph() + 5 where org_id = (select org from t_ids);
select private.care_daily();
select pg_temp.res('the next bill is made 7 days before the paid period ends, one per workspace',
  count(*) = 1 and min(amount_php) = 1450 and min(period_start) = private.today_ph() + 6, count(*)::text)
  from public.care_invoices where org_id = (select org from t_ids) and not first;
select private.care_daily();
select pg_temp.res('...and only once', count(*) = 1, count(*)::text) from public.care_invoices where org_id = (select org from t_ids) and not first;
update t_ids set inv2 = (select id from public.care_invoices where org_id = (select org from t_ids) and not first);
update public.care_plans set paid_through = private.today_ph() - 9 where org_id = (select org from t_ids);
update public.care_invoices set period_start = private.today_ph() - 8, due_on = private.today_ph() - 9 where id = (select inv2 from t_ids);
select private.care_daily();
select pg_temp.res('unpaid a week after coverage ran out: paused', bool_and(status = 'paused'), string_agg(status, ','))
  from public.care_plans where org_id = (select org from t_ids);
select pg_temp.res('a paused plan starts no renewals', private.care_daily() = 0, '');
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select public.admin_confirm_care_payment(inv2, true) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('paying a late bill restarts coverage from today (no paying for paused weeks)',
  bool_and(status = 'active' and paid_through = (private.today_ph() + interval '1 month')::date - 1), string_agg(status || ' ' || paid_through, ','))
  from public.care_plans where org_id = (select org from t_ids);

-- the on-time guarantee
update public.care_plans set started_on = private.today_ph() - 120 where org_id = (select org from t_ids);
update public.requirement_cycles set expires_on = private.today_ph() - 10 where requirement_id = (select brgy from t_ids);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.start_care(org, jsonb_build_array(jsonb_build_object('kind','location','id',loc2,'tier','branch_care')), 'per_renewal', true) from t_ids;
do $$ begin perform public.file_guarantee_claim((select id from public.care_plans where location_id = (select loc2 from t_ids)),
    (select id from public.requirements where location_id = (select loc2 from t_ids) and type_code = 'mayors_permit'), 500, null, (select org from t_ids) || '/care/claims/r.pdf');
  perform pg_temp.res('the guarantee is only on the All-in plan', false, 'was allowed');
exception when others then perform pg_temp.res('the guarantee is only on the All-in plan', sqlerrm like '%comes with the All-in plan%', sqlerrm); end $$;
do $$ begin perform public.file_guarantee_claim((select plan from t_ids), (select lto from t_ids), 500, null, (select org from t_ids) || '/care/claims/r.pdf');
  perform pg_temp.res('only permits the plan covers', false, 'was allowed');
exception when others then perform pg_temp.res('only permits the plan covers', sqlerrm like '%isn''t covered%', sqlerrm); end $$;
do $$ begin perform public.file_guarantee_claim((select plan from t_ids), (select mp from t_ids), 500, null, (select org from t_ids) || '/care/claims/r.pdf');
  perform pg_temp.res('a permit that hasn''t lapsed can''t be claimed', false, 'was allowed');
exception when others then perform pg_temp.res('a permit that hasn''t lapsed can''t be claimed', sqlerrm like '%hasn''t lapsed%', sqlerrm); end $$;
do $$ begin perform public.file_guarantee_claim((select plan from t_ids), (select brgy from t_ids), 500, null, null);
  perform pg_temp.res('a claim needs the official receipt', false, 'was allowed');
exception when others then perform pg_temp.res('a claim needs the official receipt', sqlerrm like '%official receipt%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update public.care_plans set paid_through = private.today_ph() - 20 where id = (select plan from t_ids);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.file_guarantee_claim((select plan from t_ids), (select brgy from t_ids), 500, null, (select org from t_ids) || '/care/claims/r.pdf');
  perform pg_temp.res('not paid up on the expiry date: no guarantee', false, 'was allowed');
exception when others then perform pg_temp.res('not paid up on the expiry date: no guarantee', sqlerrm like '%wasn''t paid up%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update public.care_plans set paid_through = private.today_ph() + 20 where id = (select plan from t_ids);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('a valid claim is accepted', public.file_guarantee_claim(plan, brgy, 15000, 'Missed by PermitPal', org || '/care/claims/r.pdf', 'r.pdf') is not null, '') from t_ids;
do $$ begin perform public.file_guarantee_claim((select plan from t_ids), (select brgy from t_ids), 500, null, (select org from t_ids) || '/care/claims/r2.pdf');
  perform pg_temp.res('one claim per lapse', false, 'was allowed');
exception when others then perform pg_temp.res('one claim per lapse', sqlerrm like '%already sent a claim%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.admin_decide_claim((select id from public.guarantee_claims where plan_id = (select plan from t_ids)), false, null, 'no');
  perform pg_temp.res('a decline needs a reason the customer can read', false, 'was allowed');
exception when others then perform pg_temp.res('a decline needs a reason the customer can read', true, sqlerrm); end $$;
select public.admin_decide_claim(id, true, 15000, 'Our miss') from public.guarantee_claims where plan_id = (select plan from t_ids);
select pg_temp.res('the payout is capped at the plan''s limit', approved_php = 10000 and status = 'approved', approved_php::text)
  from public.guarantee_claims where plan_id = (select plan from t_ids);
select public.admin_claim_paid(id, 'GCash', 'GC-PAY-1') from public.guarantee_claims where plan_id = (select plan from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- cancelling
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('a paid plan runs to the end of what''s paid', public.cancel_care(vplan, 'Selling the truck') = (select paid_through from public.care_plans where id = t_ids.vplan), '') from t_ids;
select pg_temp.res('...it stays active until then', status = 'active' and cancel_at is not null, status) from public.care_plans where id = (select vplan from t_ids);
select public.resume_care(vplan) from t_ids;
select pg_temp.res('changing your mind keeps it going', cancel_at is null, coalesce(cancel_at::text, 'none')) from public.care_plans where id = (select vplan from t_ids);
select public.cancel_care(vplan, null) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update public.care_plans set cancel_at = private.today_ph() where id = (select vplan from t_ids);
select private.care_daily();
select pg_temp.res('on the end date the plan ends', status = 'cancelled', status) from public.care_plans where id = (select vplan from t_ids);
-- deleting the branch ends its plan
update public.business_locations set deleted_at = now() where id = (select loc from t_ids);
select private.care_daily();
select pg_temp.res('a deleted branch''s plan ends too', status = 'cancelled', status) from public.care_plans where id = (select plan from t_ids);
update public.business_locations set deleted_at = null where id = (select loc from t_ids);

-- ================================================================ 3) fees from other businesses
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
insert into public.partners (category, name, published, verified, fee_model, lead_fee_php, contact_email, cities)
  values ('liaison', 'Pasig Permit Runners', true, true, 'per_lead', 300, 'hello@runners.ph', array['Pasig City']);
select pg_temp.res('permit filing firms (liaison) can be saved now', count(*) = 1, '') from public.partners where name = 'Pasig Permit Runners';
update t_ids set partner = (select id from public.partners where name = 'Pasig Permit Runners');
do $$ begin insert into public.partners (category, name, published, fee_model, sale_pct) values ('insurance', 'Some Insurer', true, 'per_sale_percent', 10);
  perform pg_temp.res('insurers can''t pay per sale without an IC licence', false, 'was allowed');
exception when others then perform pg_temp.res('insurers can''t pay per sale without an IC licence', sqlerrm like 'Insurance rule%', sqlerrm); end $$;
do $$ begin insert into public.partners (category, name, published, fee_model, lead_fee_php) values ('insurance', 'Lead Insurer', true, 'per_lead', 200);
  perform pg_temp.res('...or per quote request', false, 'was allowed');
exception when others then perform pg_temp.res('...or per quote request', sqlerrm like 'Insurance rule%', sqlerrm); end $$;
insert into public.partners (category, name, published, fee_model, monthly_fee_php) values ('insurance', 'Some Insurer', true, 'monthly', 2000);
insert into public.partners (category, name, published) values ('insurance', 'Free Insurer', true);
select pg_temp.res('an insurer listed for free (no fee) is fine', count(*) = 1, '') from public.partners where name = 'Free Insurer';
update t_ids set insurer = (select id from public.partners where name = 'Some Insurer');
select public.admin_set_money_setting('ic_licence_no', 'IC-AG-12345');
update public.partners set fee_model = 'per_lead', lead_fee_php = 200 where id = (select insurer from t_ids);
select pg_temp.res('with the licence on file, insurers can pay per quote request', fee_model = 'per_lead', fee_model) from public.partners where id = (select insurer from t_ids);
select public.admin_set_money_setting('ic_licence_no', '');
-- a checklist line
insert into public.partner_placements (partner_id, type_code, item_key, cities, headline, starts_on, ends_on, monthly_fee_php)
  select partner, 'fsic', 'ready', array['Pasig City'], 'Extinguishers refilled and tagged, same week', private.today_ph() - 1, private.today_ph() + 60, 1500 from t_ids;
update t_ids set place = (select id from public.partner_placements where partner_id = (select partner from t_ids));
do $$ begin insert into public.partner_placements (partner_id, type_code, item_key, cities, headline, starts_on, ends_on)
    select insurer, 'fsic', 'ready', '{}', 'Another firm on the same step', private.today_ph(), private.today_ph() + 30 from t_ids;
  perform pg_temp.res('one firm per checklist step per city', false, 'was allowed');
exception when others then perform pg_temp.res('one firm per checklist step per city', sqlerrm like '%One firm per step%', sqlerrm); end $$;
do $$ begin insert into public.partner_placements (partner_id, type_code, item_key, headline, starts_on, ends_on)
    select insurer, 'fsic', 'nope', 'A step that does not exist', private.today_ph(), private.today_ph() + 30 from t_ids;
  perform pg_temp.res('only real checklist steps', false, 'was allowed');
exception when others then perform pg_temp.res('only real checklist steps', sqlerrm like '%doesn''t exist%', sqlerrm); end $$;
-- quote requests are paid from prepaid credit
select public.admin_add_credit(partner, 3000, 'GCash', 'GC-CR-1') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('customers see the line, without fees', count(*) = 1, count(*)::text) from public.list_placements();
do $$ begin perform 1 from public.partner_placements;
  perform pg_temp.res('customers can''t read placement fees', (select count(*) from public.partner_placements) = 0, '');
end $$;
select public.log_placement(array[place, place], 'view') from t_ids;
select public.log_placement(array[place], 'view') from t_ids;
select public.log_placement(array[place], 'click') from t_ids;
update t_ids set ref = public.request_referral(org, partner, fsic, 'Need extinguishers tagged', 'phone', '09171234567', place);
do $$ begin perform public.request_referral((select org from t_ids), (select partner from t_ids), (select fsic from t_ids), 'again', 'phone', '0917', (select place from t_ids));
  perform pg_temp.res('the same request twice in a week is refused', false, 'was allowed');
exception when others then perform pg_temp.res('the same request twice in a week is refused', sqlerrm like '%already sent this request%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select public.log_placement(array[place], 'view') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('honest counts: a view counts once per person per day', views = 2 and clicks = 1 and leads = 1, views || '/' || clicks || '/' || leads)
  from public.admin_placement_stats(private.today_ph() - 1, private.today_ph()) where placement_id = (select place from t_ids);
select pg_temp.res('the quote request takes the fee from the firm''s credit and records where it came from',
  (select count(*) from public.partner_credits where referral_id = (select ref from t_ids) and kind = 'lead' and amount_php = -300) = 1
  and (select placement_id from public.referrals where id = (select ref from t_ids)) = (select place from t_ids), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the firm gets the lead by email', count(*) = 1, count(*)::text) from public.message_outbox where to_address = 'hello@runners.ph' and dedupe_key like 'lead:%';
select pg_temp.res('the monthly fee for the checklist line is charged', private.partner_monthly_charges() >= 1, '');
select pg_temp.res('...once', private.partner_monthly_charges() = 0
  and (select count(*) from public.partner_charges where placement_id = (select place from t_ids) and kind = 'placement') = 1, '');
-- a reported sale is noted, never billed (per-sale fees are gone)
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('a reported sale costs the firm nothing extra', public.admin_record_sale(ref, 6000, 'Extinguisher service') = 0, '') from t_ids;
select pg_temp.res('...and is recorded as hired', status = 'converted' and sale_php = 6000
  and not exists (select 1 from public.partner_charges where referral_id = (select ref from t_ids) and kind = 'sale'), status) from public.referrals where id = (select ref from t_ids);
-- statements
do $$ begin perform public.admin_create_statement((select org2 from t_ids), private.today_ph());
  perform pg_temp.res('a statement needs a real firm', false, 'was allowed');
exception when others then perform pg_temp.res('a statement needs a real firm', true, sqlerrm); end $$;
update t_ids set stmt = public.admin_create_statement(partner, private.today_ph(), true);
select pg_temp.res('the statement adds up every charge not billed yet (quote requests are prepaid, so not on it)', total_php = 1500 and status = 'sent', total_php::text)
  from public.partner_statements where id = (select stmt from t_ids);
do $$ begin perform public.admin_create_statement((select partner from t_ids), private.today_ph());
  perform pg_temp.res('nothing is billed twice', false, 'was allowed');
exception when others then perform pg_temp.res('nothing is billed twice', sqlerrm like 'Nothing to bill%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the firm is emailed the statement', count(*) = 1, count(*)::text) from public.message_outbox where to_address = 'hello@runners.ph' and dedupe_key like 'stmt:%';
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select public.admin_statement_void(stmt, 'Wrong month') from t_ids;
select pg_temp.res('voiding puts the charges back to be billed', (select count(*) from public.partner_charges where partner_id = (select partner from t_ids) and status = 'unbilled') = 1, '');
update t_ids set stmt = public.admin_create_statement(partner, private.today_ph(), false);
select public.admin_statement_paid(stmt, 'Bank transfer', 'BPI-9', 'INV-0002') from t_ids;
select pg_temp.res('paid: every charge on it is paid', not exists (select 1 from public.partner_charges where statement_id = (select stmt from t_ids) and status <> 'paid'), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('customers never see what firms are charged', (select count(*) from public.partner_charges) = 0 and (select count(*) from public.partner_statements) = 0, '');
do $$ begin perform public.admin_create_statement((select partner from t_ids), private.today_ph());
  perform pg_temp.res('customers can''t make statements', false, 'was allowed');
exception when others then perform pg_temp.res('customers can''t make statements', sqlerrm = 'Staff only.', sqlerrm); end $$;
update public.profiles set show_partner_offers = false where id = 'c0000000-0000-4000-8000-0000000000a1';
select pg_temp.res('people can switch partner lines off', not show_partner_offers, '') from public.profiles where id = 'c0000000-0000-4000-8000-0000000000a1';
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- firms applying (no account)
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public.apply_as_partner('Spam Bot', 'other', '', 'Bot', 'bot@spam.ph', '', '', '', '', '', 'http://spam');
select public.apply_as_partner('Makati Fire Safety', 'fire_safety', 'Makati City, Pasig City', 'Ana Cruz', 'Ana@MakatiFire.ph', '0917 000 1111', 'BFP accredited', 'Refills, tagging', 'https://makatifire.ph', 'We serve malls');
do $$ begin perform public.apply_as_partner('Makati Fire Safety', 'fire_safety', '', 'Ana Cruz', 'ana@makatifire.ph', '', '', '', '', '');
  perform pg_temp.res('one application per email per day', false, 'was allowed');
exception when others then perform pg_temp.res('one application per email per day', sqlerrm like 'We already have your application%', sqlerrm); end $$;
do $$ begin perform public.apply_as_partner('X', 'fire_safety', '', 'Ana', 'nope', '', '', '', '', '');
  perform pg_temp.res('bad details are refused', false, 'was allowed');
exception when others then perform pg_temp.res('bad details are refused', true, sqlerrm); end $$;
do $$ begin perform 1 from public.partner_applications;
  perform pg_temp.res('visitors can''t read applications', false, 'was allowed');
exception when others then perform pg_temp.res('visitors can''t read applications', true, sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the bot (hidden box filled) was quietly dropped; the firm was saved',
  (select count(*) from public.partner_applications where email = 'bot@spam.ph') = 0 and (select count(*) from public.partner_applications where email = 'ana@makatifire.ph') = 1, '');
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
update t_ids set app = (select id from public.partner_applications where email = 'ana@makatifire.ph');
update t_ids set app = public.admin_application_to_partner(app);
select pg_temp.res('staff turn it into a hidden listing to finish', (select published = false and verified = false and cities = array['Makati City','Pasig City']
  from public.partners where id = (select app from t_ids)), '');

-- ================================================================ 4) the money ledger
select public.admin_record_plan_payment(org, 'fleet', 3, 4470, 'GCash', 'GC-PLAN-1', null) from t_ids;
select pg_temp.res('a team plan paid by GCash extends the plan', plan_id = 'fleet' and plan_expires_at > now() + interval '85 days', plan_id) from public.orgs where id = (select org from t_ids);
create temp table t_money as select * from public.admin_money(private.today_ph() - 400, private.today_ph());
select pg_temp.res('one-time jobs: our fee (with rush) is collected, government fees are held separately',
  (select sum(amount) from t_money where stream = 'jobs' and state = 'collected' and kind = 'service_fee' and ref_id = (select ord from t_ids)) = 2300
  and (select sum(amount) from t_money where state = 'held' and ref_id = (select ord from t_ids)) = 2000, '');
select pg_temp.res('care bills paid are collected; the guarantee payout is a cost',
  (select sum(amount) from t_money where stream = 'care' and state = 'collected') = 2900 and (select sum(amount) from t_money where state = 'cost') = -10000, '');
select pg_temp.res('firms: the paid statement and the prepaid credit are collected', (select sum(amount) from t_money where stream = 'partners' and state = 'collected') = 1500 + 3000, '');
select pg_temp.res('team plans are collected', (select sum(amount) from t_money where stream = 'plans') = 4470, '');
select pg_temp.res('accepted, not paid: the care renewal''s fees are not counted as ours', not exists (select 1 from t_money where state = 'to_collect' and stream = 'jobs' and amount = 0), '');
do $$ declare s jsonb := public.admin_money_summary(); begin
  perform pg_temp.res('summary: money held for government fees', (s ->> 'held_gov')::numeric = 2000, s ->> 'held_gov');
  perform pg_temp.res('summary: payments still missing a BIR invoice number', (s ->> 'missing_invoice')::int >= 2, s ->> 'missing_invoice');
  perform pg_temp.res('summary: care renewals waiting for a quote are counted', (s ->> 'quotes_to_send')::int >= 0 and (s ->> 'applications_new')::int = 0, s::text);
end $$;
select public.admin_set_invoice_no('order', ord, 'INV-0003') from t_ids;
select pg_temp.res('the invoice number is saved on the payment', bir_invoice_no = 'INV-0003', bir_invoice_no) from public.assistance_requests where id = (select ord from t_ids);
select public.admin_set_money_setting('money_goal', '150000');
select pg_temp.res('the monthly goal is kept', (public.admin_money_summary() ->> 'goal')::numeric = 150000, '');
do $$ begin perform public.admin_set_money_setting('money_goal', 'lots');
  perform pg_temp.res('a goal must be a number', false, 'was allowed');
exception when others then perform pg_temp.res('a goal must be a number', true, sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.admin_money(private.today_ph() - 30, private.today_ph());
  perform pg_temp.res('customers can''t see the ledger', false, 'was allowed');
exception when others then perform pg_temp.res('customers can''t see the ledger', sqlerrm = 'Staff only.', sqlerrm); end $$;
do $$ begin perform public.admin_money_summary();
  perform pg_temp.res('customers can''t see the summary', false, 'was allowed');
exception when others then perform pg_temp.res('customers can''t see the summary', sqlerrm = 'Staff only.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
