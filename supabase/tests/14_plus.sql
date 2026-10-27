-- Pinoy Permit Plus and staff licenses: prices, the free 3 people and paid licenses, bills (moving up with
-- credit, moving down next period, renewals made ahead, paying late, online checkout), pauses when a plan
-- ends, the public permit page (statuses, hidden permits, copies, paused), recipients, the worker's upload
-- link, licenses by role, the automatic permit check, templates and the money views. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (org uuid, org2 uuid, biz uuid, mp uuid, fsic uuid, san uuid, p1 uuid, p2 uuid, p3 uuid, p4 uuid, p5 uuid, hc uuid,
  inv1 uuid, inv2 uuid, inv3 uuid, inv4 uuid, pay uuid, tok uuid, sub uuid, page uuid, code text, rcpt uuid, rcpt_tok uuid, req uuid, doc1 uuid, doc2 uuid, cyc uuid, find uuid);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('d1000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@plus.ph','{"first_name":"Sadie"}', now()),
 ('d1000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member@plus.ph','{"first_name":"Mio"}', now()),
 ('d1000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','viewer@plus.ph','{"first_name":"Vic"}', now()),
 ('d1000000-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@plus.ph','{"first_name":"Oscar"}', now()),
 ('d1000000-0000-4000-8000-0000000000f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@plus.ph','{"first_name":"Fely"}', now());
update public.profiles set is_platform_admin = true where id = 'd1000000-0000-4000-8000-0000000000f5';

create function pg_temp.today() returns date language sql stable as $f$ select (now() at time zone 'Asia/Manila')::date $f$;
grant execute on function pg_temp.today() to anon, authenticated;
create function pg_temp.as_user(u text) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $f$;

-- ---------------------------------------------------------------- prices
select pg_temp.res('staff prices: 3 free, then ₱100 to the 20th, ₱60 to the 100th, ₱40 after',
  private.staff_monthly(3) = 0 and private.staff_monthly(4) = 100 and private.staff_monthly(20) = 1700 and private.staff_monthly(21) = 1760
  and private.staff_monthly(100) = 6500 and private.staff_monthly(101) = 6540 and private.staff_monthly(200) = 10500,
  private.staff_monthly(21)::text || ' ' || private.staff_monthly(101)::text);
select pg_temp.res('one more person never costs less than before (no cliff)',
  not exists (select 1 from generate_series(3, 400) n where private.staff_monthly(n + 1) < private.staff_monthly(n)), '');
select pg_temp.res('yearly is 10 months; Plus is ₱149 or ₱1,490',
  private.addon_price('staff', 25, 'yearly') = 10 * private.addon_price('staff', 25, 'monthly') and private.addon_price('plus', null, 'monthly') = 149
  and private.addon_price('plus', null, 'yearly') = 1490, '');

-- ---------------------------------------------------------------- set-up
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Sadie Foods');
update t_ids set biz = public.create_business(org, 'Sadie''s Kitchen', 'Corporation', 'restaurant', 'Pasig City', '12 Shaw Blvd');
update t_ids set mp = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit' limit 1),
  fsic = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'fsic' limit 1),
  san = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'sanitary_permit' limit 1);
update t_ids set p1 = public.create_person(org, 'Ana Cruz', 'Cook', biz, array['health_certificate']);
update t_ids set p2 = public.create_person(org, 'Ben Reyes', 'Cook', biz, array[]::text[]);
update t_ids set p3 = public.create_person(org, 'Carla Dizon', 'Cashier', biz, array['nbi_clearance']);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.org_members (org_id, user_id, role) select org, 'd1000000-0000-4000-8000-0000000000b2', 'member' from t_ids;
insert into public.org_members (org_id, user_id, role) select org, 'd1000000-0000-4000-8000-0000000000c3', 'viewer' from t_ids;
update t_ids set hc = (select id from public.requirements where person_id = (select p1 from t_ids) and type_code = 'health_certificate');
insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on) select org, mp, 'MP-2026-0042', private.today_ph() - 300, private.today_ph() + 65 from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on) select org, fsic, 'FSIC-77', private.today_ph() - 400, private.today_ph() - 10 from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on) select org, san, 'SP-1', private.today_ph() - 20, private.today_ph() + 345 from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, hc, 'HC-1', private.today_ph() + 5 from t_ids;
insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name, mime_type, size_bytes)
  select org, mp, (select cycle_id from public.requirement_status where id = (select mp from t_ids)), org || '/' || mp || '/a-mp.jpg', 'mp.jpg', 'image/jpeg', 1000 from t_ids;
insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name, mime_type, size_bytes)
  select org, san, (select cycle_id from public.requirement_status where id = (select san from t_ids)), org || '/' || san || '/a-san.pdf', 'sanitary.pdf', 'application/pdf', 1000 from t_ids;
update t_ids set doc1 = (select id from public.documents where requirement_id = (select mp from t_ids)), doc2 = (select id from public.documents where requirement_id = (select san from t_ids));
insert into storage.objects (bucket_id, name) select 'documents', storage_path from public.documents where org_id = (select org from t_ids);
create function pg_temp.visible(p text) returns boolean language sql as $f$ select exists (select 1 from storage.objects where bucket_id = 'documents' and name = p) $f$;
grant execute on function pg_temp.visible(text) to anon, authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
update t_ids set org2 = public.create_org('Oscar Hardware');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- the free 3 people
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
do $$ begin perform public.create_person((select org from t_ids), 'Dina Lim', 'Server', null, null);
  perform pg_temp.res('a 4th person needs staff licenses', false, 'was allowed');
exception when others then perform pg_temp.res('a 4th person needs staff licenses', sqlerrm like 'You''re tracking 3 people: the free limit is 3.%', sqlerrm); end $$;
update public.people set paused_at = now() where id = (select p1 from t_ids);
select pg_temp.res('nobody can mark a person paused by hand', (select paused_at is null from public.people where id = (select p1 from t_ids)), '');
update public.people set deleted_at = now() where id = (select p3 from t_ids);
update t_ids set p4 = public.create_person(org, 'Dina Lim', 'Server', null, null);
select pg_temp.res('deleting someone frees their place', (select p4 from t_ids) is not null, '');
do $$ begin update public.people set deleted_at = null where id = (select p3 from t_ids);
  perform pg_temp.res('restoring someone from Trash counts too', false, 'was allowed');
exception when others then perform pg_temp.res('restoring someone from Trash counts too', sqlerrm like 'You''re tracking 3 people%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- choosing staff licenses
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
do $$ begin perform public.addon_checkout((select org from t_ids), 'staff', 10, 'monthly');
  perform pg_temp.res('only owners and admins choose plans', false, 'was allowed');
exception when others then perform pg_temp.res('only owners and admins choose plans', sqlerrm like 'Only the workspace owner or an admin%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
do $$ begin perform public.addon_preview((select org from t_ids), 'staff', 3, 'monthly');
  perform pg_temp.res('at least 4 people (the first 3 are free)', false, 'was allowed');
exception when others then perform pg_temp.res('at least 4 people (the first 3 are free)', sqlerrm like 'Choose from 4 to 5,000 people.%', sqlerrm); end $$;
select pg_temp.res('the screen shows the same price that will be charged',
  (q ->> 'amount')::numeric = 700 and q ->> 'mode' = 'new' and (q ->> 'period_start')::date = private.today_ph() and (q ->> 'people_now')::int = 3, q::text)
  from (select public.addon_preview(org, 'staff', 10, 'monthly') as q from t_ids) x;
update t_ids set inv1 = (public.addon_checkout(org, 'staff', 10, 'monthly') ->> 'id')::uuid;
select pg_temp.res('pressing twice gives the same bill', (public.addon_checkout(org, 'staff', 10, 'monthly') ->> 'id')::uuid = inv1
  and (select count(*) from public.addon_invoices where org_id = (select org from t_ids)) = 1, '') from t_ids;
select pg_temp.res('the bill: ₱700 for a month, numbered', amount_php = 700 and months = 1 and status = 'due' and number like 'PPA-%'
  and period_end = (period_start + interval '1 month')::date - 1, number) from public.addon_invoices where id = (select inv1 from t_ids);
do $$ begin perform public.addon_report_payment((select inv1 from t_ids), 'gcash', '', null, null);
  perform pg_temp.res('a payment needs a reference or a screenshot', false, 'was allowed');
exception when others then perform pg_temp.res('a payment needs a reference or a screenshot', sqlerrm like 'Add the reference number%', sqlerrm); end $$;
do $$ begin perform public.addon_report_payment((select inv1 from t_ids), 'gcash', '', (select org from t_ids)::text || '/other/x.png', 'x.png');
  perform pg_temp.res('a screenshot must be in the bill''s folder', false, 'was allowed');
exception when others then perform pg_temp.res('a screenshot must be in the bill''s folder', sqlerrm = 'Invalid file location.', sqlerrm); end $$;
select public.addon_report_payment(inv1, 'gcash', '1009 234 567', null, null) from t_ids;
select pg_temp.res('paid: waiting for the one check', status = 'pending_verification' and pay_ref = '1009 234 567', status) from public.addon_invoices where id = (select inv1 from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('Pinoy Permit staff are told what to confirm', exists (select 1 from public.notifications where user_id = 'd1000000-0000-4000-8000-0000000000f5' and title like 'Payment to confirm: PPA-%'), '');

select pg_temp.as_user('d1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
select pg_temp.res('another workspace can''t see the bill or the plan',
  not exists (select 1 from public.addon_invoices where org_id = (select org from t_ids)) and not exists (select 1 from public.addons where org_id = (select org from t_ids)), '');
do $$ begin perform public.addon_report_payment((select inv1 from t_ids), 'gcash', 'x', null, null);
  perform pg_temp.res('...or report a payment on it', false, 'was allowed');
exception when others then perform pg_temp.res('...or report a payment on it', sqlerrm = 'Bill not found.', sqlerrm); end $$;
do $$ begin perform public.admin_confirm_addon_payment((select inv1 from t_ids), true, null, null);
  perform pg_temp.res('only staff confirm payments', false, 'was allowed');
exception when others then perform pg_temp.res('only staff confirm payments', sqlerrm = 'Staff only.', sqlerrm); end $$;
do $$ begin insert into public.addons (org_id, kind, paid_through) values ((select org2 from t_ids), 'plus', '2030-01-01');
  perform pg_temp.res('nobody switches a plan on by writing to the table', false, 'was allowed');
exception when others then perform pg_temp.res('nobody switches a plan on by writing to the table', sqlerrm like 'permission denied%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

select pg_temp.as_user('d1000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select public.admin_confirm_addon_payment(inv1, true, null, 'INV-501') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('confirmed: 10 people until the end of the month', a.people_max = 10 and a.paid_through = i.period_end and i.status = 'paid'
  and i.bir_invoice_no = 'INV-501' and private.people_allowed(a.org_id) = 10, a.paid_through::text)
  from public.addons a join public.addon_invoices i on i.id = (select inv1 from t_ids) where a.org_id = (select org from t_ids) and a.kind = 'staff';
select pg_temp.res('the owner gets a receipt', exists (select 1 from public.notifications where user_id = 'd1000000-0000-4000-8000-0000000000a1'
  and title = 'Payment received: thank you' and body like 'Staff licenses, up to 10 people (monthly) is on until%'), '');

select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set p5 = public.create_person(org, 'Eli Santos', 'Driver', null, array['drivers_license']);
select public.create_person(org, 'Person ' || n, '', null, null) from t_ids, generate_series(6, 11) n;
select pg_temp.res('now up to 10 people', private.active_people((select org from t_ids)) = 10, '');
do $$ begin perform public.create_person((select org from t_ids), 'Eleventh', '', null, null);
  perform pg_temp.res('the 11th needs more licenses', false, 'was allowed');
exception when others then perform pg_temp.res('the 11th needs more licenses', sqlerrm like 'You''re tracking 10 people, the most your staff licenses cover.%', sqlerrm); end $$;

-- moving up: a new month from today, less the unused days (all of them, today)
select pg_temp.res('moving up to 25: ₱2,000 less ₱700 unused = ₱1,300',
  q ->> 'mode' = 'change' and (q ->> 'credit')::numeric = 700 and (q ->> 'amount')::numeric = 1300, q::text)
  from (select public.addon_preview(org, 'staff', 25, 'monthly') as q from t_ids) x;
update t_ids set inv2 = (public.addon_checkout(org, 'staff', 25, 'monthly') ->> 'id')::uuid;
-- online checkout: the existing checkout function takes the bill as plan "addon:<id>"
select pg_temp.res('online checkout gets the bill''s amount and a clear name',
  (s ->> 'amount_php')::numeric = 1300 and s ->> 'plan_name' = 'Staff licenses, up to 25 people (monthly), less ₱700.00 unused' and (s ->> 'months')::int = 1, s::text)
  from (select public.billing_start(org, 'addon:' || inv2, 1) as s from t_ids) x;
update t_ids set pay = (select id from public.payments where addon_invoice_id = (select inv2 from t_ids));
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update public.payments set checkout_id = 'cs_test_plus_1' where id = (select pay from t_ids);
select public.billing_mark_paid('cs_test_plus_1', '{"ok":true}'::jsonb);
select pg_temp.res('paid online: 25 people, the bill closes itself', a.people_max = 25 and i.status = 'paid' and i.pay_method = 'online'
  and a.paid_through = (private.today_ph() + interval '1 month')::date - 1, a.people_max::text)
  from public.addons a join public.addon_invoices i on i.id = (select inv2 from t_ids) where a.org_id = (select org from t_ids) and a.kind = 'staff';
select public.billing_mark_paid('cs_test_plus_1', '{"ok":true}'::jsonb);
select pg_temp.res('a repeated payment message changes nothing', (select count(*) from public.addon_invoices where org_id = (select org from t_ids) and status = 'paid') = 2, '');

-- moving down: from the next period, and nobody can be added past it meanwhile
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
do $$ begin perform public.addon_checkout((select org from t_ids), 'staff', 8, 'monthly');
  perform pg_temp.res('can''t choose fewer than the people tracked', false, 'was allowed');
exception when others then perform pg_temp.res('can''t choose fewer than the people tracked', sqlerrm like 'You''re tracking 10 people. Remove people first, or choose at least 10.', sqlerrm); end $$;
select pg_temp.res('moving down to 12 starts next period (nothing to pay now)', (q ->> 'scheduled')::boolean and q ->> 'mode' = 'next_period', q::text)
  from (select public.addon_checkout(org, 'staff', 12, 'monthly') as q from t_ids) x;
select public.create_person(org, 'Eleventh', '', null, null), public.create_person(org, 'Twelfth', '', null, null) from t_ids;
do $$ begin perform public.create_person((select org from t_ids), 'Thirteenth', '', null, null);
  perform pg_temp.res('...and no one is added past it meanwhile', false, 'was allowed');
exception when others then perform pg_temp.res('...and no one is added past it meanwhile', sqlerrm like 'You''re tracking 12 people%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- the next bill is made 7 days ahead, with the move down
update public.addons set paid_through = private.today_ph() + 5 where org_id = (select org from t_ids) and kind = 'staff';
update public.addon_invoices set period_end = private.today_ph() + 5 where id = (select inv2 from t_ids);
select private.plus_daily();
update t_ids set inv3 = (select id from public.addon_invoices where org_id = (select org from t_ids) and renewal and status = 'due');
select pg_temp.res('a week ahead: next month''s bill for 12 people (₱900)', i.people_max = 12 and i.amount_php = 900 and i.period_start = private.today_ph() + 6
  and i.valid_until = private.today_ph() + 19, coalesce(i.amount_php::text, 'none')) from public.addon_invoices i where i.id = (select inv3 from t_ids);
select pg_temp.res('...the owner is told', exists (select 1 from public.notifications where user_id = 'd1000000-0000-4000-8000-0000000000a1'
  and title like 'Staff licenses, up to 12 people (monthly) renews on%'), '');
select private.plus_daily();
select pg_temp.res('...only once', (select count(*) from public.addon_invoices where org_id = (select org from t_ids) and renewal) = 1, '');

-- the plan ends unpaid: people above the free 3 pause (newest first), nothing is deleted
update public.people set created_at = now() - interval '3 days' where id = (select p1 from t_ids);
update public.people set created_at = now() - interval '2 days' where id = (select p2 from t_ids);
update public.people set created_at = now() - interval '1 day' where id = (select p4 from t_ids);
update public.addons set paid_through = private.today_ph() - 1 where org_id = (select org from t_ids) and kind = 'staff';
update public.addon_invoices set period_start = private.today_ph() where id = (select inv3 from t_ids);
select private.plus_daily();
select pg_temp.res('ended: 9 of 12 people paused, the oldest 3 stay on', (select count(*) from public.people where org_id = (select org from t_ids) and deleted_at is null and paused_at is not null) = 9
  and (select paused_at is null from public.people where id = (select p1 from t_ids)) and (select paused_at is not null from public.people where id = (select p5 from t_ids)), '');
select pg_temp.res('...and the owner is told', exists (select 1 from public.notifications where user_id = 'd1000000-0000-4000-8000-0000000000a1'
  and title = 'Your staff licenses have ended' and body like 'Reminders for 9 of your 12 people are paused%'), '');
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
  select org, (select id from public.requirements where person_id = (select p5 from t_ids) and type_code = 'drivers_license'), 'DL-1', private.today_ph() + 1 from t_ids;
select private.queue_due_reminders();
select pg_temp.res('a paused person''s license sends no reminder', not exists (select 1 from public.notifications n join public.requirements r on r.id = n.requirement_id
  where r.person_id = (select p5 from t_ids)), '');
select pg_temp.res('...while the others still do', exists (select 1 from public.notifications n where n.requirement_id = (select hc from t_ids)), '');
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
do $$ begin perform public.worker_link((select id from public.requirements where person_id = (select p5 from t_ids) and type_code = 'drivers_license'));
  perform pg_temp.res('no upload link for a paused person', false, 'was allowed');
exception when others then perform pg_temp.res('no upload link for a paused person', sqlerrm like 'This person is paused%', sqlerrm); end $$;
-- paying the late bill: the month starts the day it's paid, not the day it was due
select public.addon_report_payment(inv3, 'bank_transfer', 'UB-77', null, null) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update public.addon_invoices set period_start = private.today_ph() - 2 where id = (select inv3 from t_ids);
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select public.admin_confirm_addon_payment(inv3, true, null, null) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('paid late: the month starts today, everyone wakes up', i.period_start = private.today_ph() and a.paid_through = (private.today_ph() + interval '1 month')::date - 1
  and not exists (select 1 from public.people where org_id = (select org from t_ids) and paused_at is not null) and a.next_people_max is null, i.period_start::text)
  from public.addon_invoices i join public.addons a on a.org_id = i.org_id and a.kind = 'staff' where i.id = (select inv3 from t_ids);

-- ---------------------------------------------------------------- Plus: trial, page, check, templates
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('every workspace sees the templates list, without the full text',
  (select count(*) from public.list_templates()) = 8 and not exists (select 1 from public.list_templates() where preview like '%{{%'), '');
do $$ begin perform public.get_template((select org from t_ids), 'affidavit_of_loss');
  perform pg_temp.res('the full template is Plus only', false, 'was allowed');
exception when others then perform pg_temp.res('the full template is Plus only', sqlerrm like 'Ready-to-use templates come with Pinoy Permit Plus%', sqlerrm); end $$;
do $$ begin perform public.trust_page_save((select org from t_ids), (select biz from t_ids), 'Sadie''s Kitchen');
  perform pg_temp.res('the public page is Plus only', false, 'was allowed');
exception when others then perform pg_temp.res('the public page is Plus only', sqlerrm like 'Your public permit page comes with Pinoy Permit Plus.', sqlerrm); end $$;
select pg_temp.res('free workspaces see how many things the check found, not the list',
  (c ->> 'plus')::boolean = false and (c ->> 'fix')::int > 0 and not exists (select 1 from public.audit_findings where org_id = (select org from t_ids)), c::text)
  from (select public.run_permit_check(org) as c from t_ids) x;
select pg_temp.res('a 14-day free trial', public.start_plus_trial(org) = private.today_ph() + 13, '') from t_ids;
select pg_temp.res('...Plus is on', private.has_plus(org), '') from t_ids;
do $$ begin perform public.start_plus_trial((select org from t_ids));
  perform pg_temp.res('...once', false, 'was allowed');
exception when others then perform pg_temp.res('...once', sqlerrm = 'Plus is already on.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the first permit check runs and is emailed', exists (select 1 from public.audit_runs where org_id = (select org from t_ids) and trigger = 'start')
  and exists (select 1 from public.message_outbox where to_address = 'owner@plus.ph' and subject like 'Pinoy Permit: Your first permit check: Sadie Foods'), '');
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('paying during the trial keeps the free days', q ->> 'mode' = 'after_trial' and (q ->> 'period_start')::date = private.today_ph() + 14, q::text)
  from (select public.addon_preview(org, 'plus', null, 'yearly') as q from t_ids) x;
select pg_temp.res('templates now give the full text', (t ->> 'body') like '%AFFIDAVIT OF LOSS%{{owner_name}}%' and (t ->> 'notarize')::boolean, '')
  from (select public.get_template(org, 'affidavit_of_loss') as t from t_ids) x;

-- ---------------------------------------------------------------- the automatic permit check
select public.run_permit_check(org) from t_ids;
select pg_temp.res('facts: expired, no copy, no details (fix)',
  exists (select 1 from public.audit_findings where requirement_id = (select fsic from t_ids) and kind = 'expired' and severity = 'fix' and status = 'open')
  and exists (select 1 from public.audit_findings where requirement_id = (select fsic from t_ids) and kind = 'no_copy')
  and exists (select 1 from public.audit_findings where org_id = (select org from t_ids) and kind = 'no_details' and severity = 'fix'), '');
select pg_temp.res('coming up: the Mayor''s permit in 65 days isn''t "soon" yet; the health card in 5 days is',
  not exists (select 1 from public.audit_findings where requirement_id = (select mp from t_ids) and kind = 'due_soon')
  and exists (select 1 from public.audit_findings where requirement_id = (select hc from t_ids) and kind = 'due_soon' and severity = 'soon'), '');
select pg_temp.res('nothing about paperwork that is complete', not exists (select 1 from public.audit_findings where requirement_id = (select san from t_ids) and status = 'open'), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
-- an expiry far beyond what this permit usually lasts, a missing usual permit, a photo that disagrees, a duplicate
update public.requirement_cycles set expires_on = private.today_ph() + 900 where requirement_id = (select san from t_ids);
update public.requirements set deleted_at = now() where id = (select (select id from public.requirements where business_id = biz and type_code = 'barangay_clearance' limit 1) from t_ids);
insert into public.requirements (org_id, subject, business_id, name, expires) select org, 'business', biz, 'Mayor''s Permit', true from t_ids;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.save_document_reading(doc1, '{"expires":["2031-01-20"],"kind":"mayors_permit","chars":900}'::jsonb) from t_ids;
select set_config('pp.t_runs', (select count(*) from public.audit_runs where org_id = (select org from t_ids))::text, true);
select public.run_permit_check(org) from t_ids;
select pg_temp.res('opening the check again within 20 seconds reuses the last run', (select count(*) from public.audit_runs where org_id = (select org from t_ids)) = current_setting('pp.t_runs')::int, '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select private.run_audit((select org from t_ids), 'manual');
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('questions: an unusual expiry date is asked, not stated',
  exists (select 1 from public.audit_findings where requirement_id = (select san from t_ids) and kind = 'date_check' and severity = 'confirm' and title like 'Is the expiry date right?%'), '');
select pg_temp.res('...a permit restaurants usually need, missing from the list',
  exists (select 1 from public.audit_findings where business_id = (select biz from t_ids) and kind = 'missing_common' and type_code = 'barangay_clearance' and severity = 'confirm'), '');
select pg_temp.res('...a photo that seems to show another date', exists (select 1 from public.audit_findings where requirement_id = (select mp from t_ids) and kind = 'photo_date' and severity = 'confirm'), '');
select pg_temp.res('...a permit listed twice', exists (select 1 from public.audit_findings where org_id = (select org from t_ids) and kind = 'duplicate'), '');
update t_ids set find = (select id from public.audit_findings where requirement_id = (select fsic from t_ids) and kind = 'expired');
do $$ begin perform public.dismiss_finding((select find from t_ids), 'meh');
  perform pg_temp.res('facts can''t be waved away', false, 'was allowed');
exception when others then perform pg_temp.res('facts can''t be waved away', sqlerrm like 'This one closes by itself%', sqlerrm); end $$;
update t_ids set find = (select id from public.audit_findings where business_id = (select biz from t_ids) and kind = 'missing_common' and type_code = 'barangay_clearance');
select public.dismiss_finding(find, 'Our building has one for all tenants') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select private.run_audit((select org from t_ids), 'manual');
select pg_temp.res('"Doesn''t apply" stays answered', (select status from public.audit_findings where id = (select find from t_ids)) = 'dismissed', '');
update t_ids set find = (select id from public.audit_findings where requirement_id = (select san from t_ids) and kind = 'date_check');
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.dismiss_finding(find) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update public.requirement_cycles set expires_on = private.today_ph() + 950 where requirement_id = (select san from t_ids);
select private.run_audit((select org from t_ids), 'manual');
select pg_temp.res('"It''s right" comes back when the record changes', (select status from public.audit_findings where id = (select find from t_ids)) = 'open', '');
update public.requirement_cycles set expires_on = private.today_ph() + 345 where requirement_id = (select san from t_ids);
insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name) select org, fsic, (select cycle_id from public.requirement_status where id = (select fsic from t_ids)),
  org || '/' || fsic || '/f.pdf', 'fsic.pdf' from t_ids;
insert into storage.objects (bucket_id, name) select 'documents', org || '/' || fsic || '/f.pdf' from t_ids;
select private.run_audit((select org from t_ids), 'manual');
select pg_temp.res('fixed things close by themselves', (select status from public.audit_findings where id = (select find from t_ids)) = 'fixed'
  and (select status from public.audit_findings where requirement_id = (select fsic from t_ids) and kind = 'no_copy') = 'fixed', '');
select pg_temp.res('the run is summed up', fix > 0 and items > 0 and in_order >= 1, fix || ' fix / ' || items || ' items') from public.audit_runs where org_id = (select org from t_ids) order by id desc limit 1;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
do $$ begin perform public.save_document_reading((select doc1 from t_ids), '{"expires":["2030-01-01"]}'::jsonb);
  perform pg_temp.res('another workspace can''t touch the readings', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace can''t touch the readings', sqlerrm = 'Document not found.', sqlerrm); end $$;
select pg_temp.res('...or see the findings', not exists (select 1 from public.audit_findings where org_id = (select org from t_ids)), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- licenses by role
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select public.save_staff_role(org, 'Cook', array['health_certificate', 'not_a_type']) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select private.run_audit((select org from t_ids), 'manual');
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('a cook without a health card is pointed out (the business''s own rule)',
  exists (select 1 from public.audit_findings where person_id = (select p2 from t_ids) and kind = 'role_missing' and type_code = 'health_certificate' and severity = 'fix'), '');
select pg_temp.res('roles keep only real license types', (select type_codes = array['health_certificate'] from public.staff_roles where org_id = (select org from t_ids)), '');
select pg_temp.res('one tap adds it to everyone in the role who lacks it', public.apply_staff_role(id) = 1, '') from public.staff_roles where org_id = (select org from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select private.run_audit((select org from t_ids), 'manual');
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('...and the finding closes', (select status from public.audit_findings where person_id = (select p2 from t_ids) and kind = 'role_missing') = 'fixed', '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- the public permit page
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set page = (public.trust_page_save(org, biz, 'Sadie''s Kitchen', 'Family restaurant since 2009', false, true, true, 'off', array[]::uuid[], true)).id;
update t_ids set code = (select code from public.trust_pages where id = (select page from t_ids));
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the page gets a short random address', code ~ '^[a-z0-9]{10}$', code) from t_ids;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
create temp table t_page as select public.get_trust_page((select code from t_ids), 'qr', null) as p;
select pg_temp.res('anyone can open it: green, amber and red, from live records',
  p ->> 'state' = 'live' and p ->> 'business' = 'Sadie''s Kitchen' and p ->> 'city' = 'Pasig City'
  and exists (select 1 from jsonb_array_elements(p -> 'items') i where i ->> 'id' = (select fsic::text from t_ids) and i ->> 'state' = 'expired')
  and exists (select 1 from jsonb_array_elements(p -> 'items') i where i ->> 'id' = (select san::text from t_ids) and i ->> 'state' = 'ok')
  and exists (select 1 from jsonb_array_elements(p -> 'items') i where i ->> 'id' = (select mp::text from t_ids) and i ->> 'state' = 'ok'), left(p::text, 200)) from t_page;
select pg_temp.res('reference numbers show only their last 4', exists (select 1 from jsonb_array_elements(p -> 'items') i where i ->> 'id' = (select mp::text from t_ids) and i ->> 'ref' = '•••• 0042')
  and p::text not like '%MP-2026-0042%', '') from t_page;
select pg_temp.res('staff: counts only, never names', (p -> 'staff' ->> 'people')::int >= 1 and p::text not like '%Ana Cruz%' and p::text not like '%HC-1%', '') from t_page;
select pg_temp.res('no copies unless the business allows them', not exists (select 1 from jsonb_array_elements(p -> 'items') i where i -> 'files' <> 'null'::jsonb)
  and not pg_temp.visible((select org || '/' || san || '/a-san.pdf' from t_ids)), '') from t_page;
select pg_temp.res('a wrong address shows nothing', public.get_trust_page('zzzzzzzzzz', 'link', null) ->> 'state' = 'missing'
  and public.get_trust_page('x''; drop table x', 'link', null) ->> 'state' = 'missing', '');
do $$ begin perform 1 from public.trust_pages;
  perform pg_temp.res('visitors can''t read the page settings', false, 'was allowed');
exception when others then perform pg_temp.res('visitors can''t read the page settings', sqlerrm like 'permission denied%', sqlerrm); end $$;
do $$ begin perform 1 from public.trust_recipients;
  perform pg_temp.res('...or who gets the updates', false, 'was allowed');
exception when others then perform pg_temp.res('...or who gets the updates', sqlerrm like 'permission denied%', sqlerrm); end $$;
select pg_temp.res('the website badge shows just the headline', b ->> 'state' = 'live' and (b ->> 'expired')::int = 1 and (b ->> 'ok')::int >= 2 and not b ? 'items_list', b::text)
  from (select public.trust_badge((select code from t_ids)) as b) x;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('...without counting a visit', (select count(*) from public.trust_page_views where page_id = (select page from t_ids)) = 1, '');
select pg_temp.res('the visit is counted by where it came from', exists (select 1 from public.trust_page_views where page_id = (select page from t_ids) and source = 'qr'), '');

select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.trust_page_save(org, biz, 'Sadie''s Kitchen', null, false, false, false, 'everyone', array[fsic], true) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('a permit the business hides isn''t listed', not exists (select 1 from jsonb_array_elements(public.get_trust_page((select code from t_ids), 'link', null) -> 'items') i
  where i ->> 'id' = (select fsic::text from t_ids)), '');
select pg_temp.res('with downloads on, current copies can be downloaded', pg_temp.visible((select org || '/' || san || '/a-san.pdf' from t_ids))
  and exists (select 1 from jsonb_array_elements(public.get_trust_page((select code from t_ids), 'link', null) -> 'items') i where case when jsonb_typeof(i -> 'files') = 'array' then jsonb_array_length(i -> 'files') end = 1), '');
select pg_temp.res('...but never a hidden permit''s copy, or anything else', not pg_temp.visible((select org || '/' || fsic || '/f.pdf' from t_ids))
  and (select count(*) from storage.objects) = 2, '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
-- an old copy (replaced by a renewal) stops being downloadable
insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on) select org, san, 'SP-2', private.today_ph(), private.today_ph() + 365 from t_ids;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('...nor an old copy once renewed', not pg_temp.visible((select org || '/' || san || '/a-san.pdf' from t_ids)), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.trust_page_save(org, biz, 'Sadie''s Kitchen', null, false, false, false, 'recipients', array[]::uuid[], true) from t_ids;
update t_ids set rcpt = public.trust_add_recipient(page, 'Ana of SM Supermalls', 'SM Supermalls', 'Vendor.Desk@SMmalls.ph');
do $$ begin perform public.trust_add_recipient((select page from t_ids), 'X', null, 'not-an-email');
  perform pg_temp.res('recipients need a real email', false, 'was allowed');
exception when others then perform pg_temp.res('recipients need a real email', sqlerrm = 'Enter a valid email address.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update t_ids set rcpt_tok = (select token from public.trust_recipients where id = (select rcpt from t_ids));
select pg_temp.res('a recipient gets a welcome with their own link and a way to stop', exists (select 1 from public.message_outbox where to_address = 'vendor.desk@smmalls.ph'
  and subject = 'Sadie''s Kitchen will send you their permit renewals' and body_text like '%p.html?c=' || (select code from t_ids) || '&r=%' and body_text like '%&stop=1%'), '');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('"recipients only": visitors can''t download, recipients can',
  not (public.get_trust_page((select code from t_ids), 'link', null) ->> 'can_download')::boolean
  and (public.get_trust_page((select code from t_ids), 'email', (select rcpt_tok from t_ids)) ->> 'can_download')::boolean, '');
select pg_temp.res('a visitor can ask for updates (nobody is emailed until the business says yes)', (public.trust_request_updates((select code from t_ids), 'Ramon', 'Robinsons', 'ramon@robinsons.ph', 'For accreditation') ->> 'ok')::boolean, '');
select pg_temp.res('asking twice adds nothing', (public.trust_request_updates((select code from t_ids), 'Ramon', 'Robinsons', 'RAMON@robinsons.ph') ->> 'ok')::boolean, '');
do $$ declare i int; begin for i in 1..10 loop perform public.trust_request_updates((select code from t_ids), 'Spam ' || i, null, 'spam' || i || '@x.ph'); end loop;
  perform pg_temp.res('at most 10 requests a day per page', false, 'was allowed');
exception when others then perform pg_temp.res('at most 10 requests a day per page', sqlerrm like 'This business has had a lot of requests today.%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the request waits for the business', (select status from public.trust_recipients where email = 'ramon@robinsons.ph') = 'requested'
  and exists (select 1 from public.notifications where user_id = 'd1000000-0000-4000-8000-0000000000a1' and title = 'Ramon (Robinsons) asked for your permit updates')
  and not exists (select 1 from public.message_outbox where to_address = 'ramon@robinsons.ph'), '');
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.trust_decide_request(id, true) from public.trust_recipients where email = 'ramon@robinsons.ph';
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('...yes: they get the welcome', exists (select 1 from public.message_outbox where to_address = 'ramon@robinsons.ph' and dedupe_key like 'trustwelcome:%'), '');
-- a renewal (with its copy) goes to recipients, once
update public.requirement_cycles set created_at = now() - interval '1 hour' where requirement_id = (select san from t_ids) and reference_no = 'SP-2';
update public.trust_recipients set created_at = now() - interval '1 day' where page_id = (select page from t_ids);
update public.requirement_cycles set created_at = now() - interval '2 days' where requirement_id in (select mp from t_ids union select fsic from t_ids);
insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name) select org, san, (select cycle_id from public.requirement_status where id = (select san from t_ids)),
  org || '/' || san || '/new.pdf', 'sanitary-2027.pdf' from t_ids;
insert into storage.objects (bucket_id, name) select 'documents', org || '/' || san || '/new.pdf' from t_ids;
select private.trust_updates();
select pg_temp.res('a renewal is emailed to each recipient (records from before they joined are not)', (select count(*) from public.message_outbox where dedupe_key like 'trustupd:%' and subject = 'Sadie''s Kitchen updated their Sanitary Permit'
  and body_text like '%Sanitary Permit, valid until%') = 2, '');
select pg_temp.res('...once', private.trust_updates() = 0, '');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('"Stop these emails" works without an account', public.trust_unsubscribe((select rcpt_tok from t_ids)), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('...and they''re off the list', (select status from public.trust_recipients where id = (select rcpt from t_ids)) = 'removed', '');

select pg_temp.as_user('d1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
select pg_temp.res('another workspace can''t see the page, its recipients or visits', not exists (select 1 from public.trust_pages where org_id = (select org from t_ids))
  and not exists (select 1 from public.trust_recipients where org_id = (select org from t_ids)) and not exists (select 1 from public.trust_page_views where org_id = (select org from t_ids)), '');
do $$ begin perform public.trust_page_save((select org from t_ids), null, 'Hijack');
  perform pg_temp.res('...or change it', false, 'was allowed');
exception when others then perform pg_temp.res('...or change it', sqlerrm like 'You can''t change this workspace.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- a new address: old link and QR stop
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.trust_page_new_code(page) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('a new address retires the old one', public.get_trust_page((select code from t_ids), 'link', null) ->> 'state' = 'missing', '');
update t_ids set code = (select code from public.trust_pages where id = (select page from t_ids));

-- ---------------------------------------------------------------- the worker's own upload link
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update public.people set email = 'ana.cruz@gmail.com', mobile = '0917 555 1234' where id = (select p1 from t_ids);
do $$ begin update public.people set email = 'nope' where id = (select p2 from t_ids);
  perform pg_temp.res('a worker''s email must look like one', false, 'was allowed');
exception when others then perform pg_temp.res('a worker''s email must look like one', sqlerrm like '%people_email_check%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select private.worker_reminders();
select pg_temp.res('the worker is reminded too, with their link', exists (select 1 from public.message_outbox where to_address = 'ana.cruz@gmail.com'
  and subject like 'Your Health Certificate%expires on%' and body_text like '%#/w/%'), '');
select pg_temp.res('...once per stage', private.worker_reminders() = 0, '');
update t_ids set tok = (select token from public.worker_links where requirement_id = (select hc from t_ids) and used_at is null);
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000c3');
set local role authenticated;
do $$ begin perform public.worker_link((select hc from t_ids));
  perform pg_temp.res('viewers can''t make upload links', false, 'was allowed');
exception when others then perform pg_temp.res('viewers can''t make upload links', sqlerrm = 'License not found.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('HR gets the same open link to send by Viber or SMS', public.worker_link(hc) = tok, '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('the worker sees only their first name, the business and the license',
  w ->> 'state' = 'open' and w ->> 'first_name' = 'Ana' and w ->> 'permit' = 'Health Certificate / Health Card' and w::text not like '%Cruz%', w::text)
  from (select public.worker_page((select tok from t_ids)) as w) x;
select pg_temp.res('a made-up link shows nothing', public.worker_page(gen_random_uuid()) ->> 'state' = 'invalid', '');
do $$ begin insert into storage.objects (bucket_id, name) select 'documents', org || '/' || mp || '/sneaky.jpg' from t_ids;
  perform pg_temp.res('a visitor can''t upload anywhere else', false, 'was allowed');
exception when others then perform pg_temp.res('a visitor can''t upload anywhere else', sqlerrm like '%row-level security%', sqlerrm); end $$;
do $$ begin insert into storage.objects (bucket_id, name) select 'documents', org2 || '/worker/' || tok || '/x.jpg' from t_ids;
  perform pg_temp.res('...nor into another workspace with the same link', false, 'was allowed');
exception when others then perform pg_temp.res('...nor into another workspace with the same link', sqlerrm like '%row-level security%', sqlerrm); end $$;
do $$ begin insert into storage.objects (bucket_id, name) select 'documents', org || '/worker/' || gen_random_uuid() || '/x.jpg' from t_ids;
  perform pg_temp.res('...nor with a made-up link', false, 'was allowed');
exception when others then perform pg_temp.res('...nor with a made-up link', sqlerrm like '%row-level security%', sqlerrm); end $$;
do $$ begin perform public.worker_submit((select tok from t_ids), (select org || '/worker/' || tok || '/x-hc.jpg' from t_ids), 'hc.jpg', 'image/jpeg', 5000, pg_temp.today() + 365);
  perform pg_temp.res('a photo has to be uploaded first', false, 'was allowed');
exception when others then perform pg_temp.res('a photo has to be uploaded first', sqlerrm = 'Add a photo of the new license first.', sqlerrm); end $$;
insert into storage.objects (bucket_id, name) select 'documents', org || '/worker/' || tok || '/x-hc.jpg' from t_ids;
select pg_temp.res('the worker uploads into their link''s folder (and can see it)', pg_temp.visible((select org || '/worker/' || tok || '/x-hc.jpg' from t_ids)), '');
do $$ declare i int; begin for i in 1..5 loop insert into storage.objects (bucket_id, name) select 'documents', org || '/worker/' || tok || '/extra' || i || '.jpg' from t_ids; end loop;
  perform pg_temp.res('at most 5 files per link', false, 'was allowed');
exception when others then perform pg_temp.res('at most 5 files per link', sqlerrm like '%row-level security%', sqlerrm); end $$;
do $$ begin perform public.worker_submit((select tok from t_ids), (select org || '/worker/' || tok || '/x-hc.jpg' from t_ids), 'hc.jpg', 'image/jpeg', 5000, null);
  perform pg_temp.res('the new expiry date is needed', false, 'was allowed');
exception when others then perform pg_temp.res('the new expiry date is needed', sqlerrm like 'Enter the new expiry date%', sqlerrm); end $$;
select pg_temp.res('the worker sends it', (public.worker_submit((select tok from t_ids), (select org || '/worker/' || tok || '/x-hc.jpg' from t_ids), 'hc.jpg', 'image/jpeg', 5000,
  pg_temp.today() + 365, pg_temp.today(), 'HC-2', null) ->> 'ok')::boolean, '');
do $$ begin perform public.worker_submit((select tok from t_ids), (select org || '/worker/' || tok || '/x-hc.jpg' from t_ids), 'hc.jpg', 'image/jpeg', 5000, pg_temp.today() + 365);
  perform pg_temp.res('a link works once', false, 'was allowed');
exception when others then perform pg_temp.res('a link works once', sqlerrm like 'This link has already been used%', sqlerrm); end $$;
do $$ begin insert into storage.objects (bucket_id, name) select 'documents', org || '/worker/' || tok || '/y.jpg' from t_ids;
  perform pg_temp.res('...and no more uploads go there', false, 'was allowed');
exception when others then perform pg_temp.res('...and no more uploads go there', sqlerrm like '%row-level security%', sqlerrm); end $$;
select pg_temp.res('...nor can the visitor still see it', not pg_temp.visible((select org || '/worker/' || tok || '/x-hc.jpg' from t_ids)), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('HR is told to check it', exists (select 1 from public.notifications where user_id = 'd1000000-0000-4000-8000-0000000000a1' and title = 'Ana Cruz sent a renewed Health Certificate / Health Card'), '');
update t_ids set sub = (select id from public.worker_submissions where token = (select tok from t_ids));
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
do $$ begin perform public.worker_decide((select sub from t_ids), true);
  perform pg_temp.res('another workspace can''t approve it', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace can''t approve it', sqlerrm = 'Not found.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
update t_ids set cyc = public.worker_decide(sub, true, null, null, null, null);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('approved: it becomes the new record with its photo', rs.cycle_id = (select cyc from t_ids) and rs.expires_on = pg_temp.today() + 365
  and rs.reference_no = 'HC-2' and rs.document_count = 1 and rs.status = 'compliant', rs.status) from public.requirement_status rs where rs.id = (select hc from t_ids);
-- sending one back: the worker gets the reason and a new link
update public.requirement_cycles set expires_on = pg_temp.today() + 3 where id = (select cyc from t_ids);
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
update t_ids set tok = public.worker_link(hc);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into storage.objects (bucket_id, name) select 'documents', org || '/worker/' || tok || '/blurry.jpg' from t_ids;
select public.worker_submit(tok, org || '/worker/' || tok || '/blurry.jpg', 'blurry.jpg', 'image/jpeg', 100, pg_temp.today() + 300) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select public.worker_decide(id, false, null, null, null, 'The photo is blurry') from public.worker_submissions where status = 'pending';
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('sent back: the worker gets the reason and a new link', exists (select 1 from public.message_outbox where to_address = 'ana.cruz@gmail.com'
  and subject like 'Please send your Health Certificate%again' and body_text like '%The photo is blurry%#/w/%'), '');

-- ---------------------------------------------------------------- Plus ends: the page pauses, nothing is deleted
update public.addons set paid_through = private.today_ph() - 1, trial = true where org_id = (select org from t_ids) and kind = 'plus';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('without Plus the page says "paused" and shows nothing else', p ->> 'state' = 'paused' and not p ? 'items', p::text)
  from (select public.get_trust_page((select code from t_ids), 'qr', null) as p) x;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('...and copies stop', not pg_temp.visible((select org || '/' || san || '/new.pdf' from t_ids)), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('...but the page and its settings are kept', exists (select 1 from public.trust_pages where id = (select page from t_ids)), '');
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
do $$ begin perform public.start_plus_trial((select org from t_ids));
  perform pg_temp.res('one free trial per workspace', false, 'was allowed');
exception when others then perform pg_temp.res('one free trial per workspace', sqlerrm = 'This workspace has already had its free trial.', sqlerrm); end $$;
update t_ids set inv4 = (public.addon_checkout(org, 'plus', null, 'yearly') ->> 'id')::uuid;
select pg_temp.res('Plus yearly after the trial: ₱1,490 from today', amount_php = 1490 and months = 12 and period_start = private.today_ph(), amount_php::text)
  from public.addon_invoices where id = (select inv4 from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- a payment screenshot on a bill: staff can open it (and it's logged), nobody else's path works
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.addon_report_payment(inv4, 'gcash', null, org || '/billing/' || inv4 || '/abc123-proof.png', 'proof.png') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('staff can open a bill''s payment screenshot', public.staff_open_file((select org || '/billing/' || inv4 || '/abc123-proof.png' from t_ids)) = 'abc123-proof.png', '');
do $$ begin perform public.staff_open_file((select org || '/billing/' || inv4 || '/other.png' from t_ids));
  perform pg_temp.res('...only that file', false, 'was allowed');
exception when others then perform pg_temp.res('...only that file', sqlerrm = 'This file is not part of a bill.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('...and it''s in the customer''s staff access log', exists (select 1 from public.staff_file_access where file_path like '%/billing/%' and reason like 'Payment proof, bill PPA-%'), '');

-- a team plan includes Plus
update public.orgs set kind = 'firm', plan_id = 'firm', plan_expires_at = now() + interval '20 days' where id = (select org2 from t_ids);
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
select pg_temp.res('team plans include Plus', private.has_plus((select org2 from t_ids)), '');
do $$ begin perform public.addon_checkout((select org2 from t_ids), 'plus', null, 'monthly');
  perform pg_temp.res('...so nobody pays for it twice', false, 'was allowed');
exception when others then perform pg_temp.res('...so nobody pays for it twice', sqlerrm = 'Plus is already included in your team plan.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- money views
select pg_temp.as_user('d1000000-0000-4000-8000-0000000000f5');
set local role authenticated;
create temp table t_money as select * from public.admin_money(private.today_ph() - 5, private.today_ph());
select pg_temp.res('Money counts staff licenses as income, and open bills as to collect',
  (select sum(amount) from t_money where kind = 'staff_licences' and state = 'collected') = 700 + 1300 + 900
  and exists (select 1 from t_money where kind = 'plus' and state = 'to_collect' and amount = 1490), '');
select pg_temp.res('the summary shows what to confirm and the monthly income', (s ->> 'addon_payments_to_check')::int = 1 and (s ->> 'mrr_addons')::numeric = 900
  and (s ->> 'staff_paying')::int = 1, s ->> 'mrr_addons') from (select public.admin_money_summary() as s) x;
select public.admin_set_invoice_no('addon', inv2, 'INV-777') from t_ids;
select pg_temp.res('BIR invoice numbers for these bills', (select bir_invoice_no from public.addon_invoices where id = (select inv2 from t_ids)) = 'INV-777', '');
select public.admin_set_addon(org2, 'staff', 40, private.today_ph() + 60, 'Launch partner') from t_ids;
select pg_temp.res('staff can give time (no bill)', a.comped and a.people_max = 40 and private.people_allowed(a.org_id) = 40, '')
  from public.addons a where a.org_id = (select org2 from t_ids) and a.kind = 'staff';
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin perform public.addon_checkout((select org from t_ids), 'plus', null, 'monthly');
  perform pg_temp.res('visitors can''t call account functions', false, 'was allowed');
exception when others then perform pg_temp.res('visitors can''t call account functions', sqlerrm like 'permission denied%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
