-- Done-for-you orders, people (staff licences), costs, sharing, partners and referrals.
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

-- ---------------------------------------------------------------- customer: data, a person, a renewal order
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
insert into t_results (step, ok, detail) select 'person gets the chosen licences', count(*) = 2, string_agg(name, ', ')
  from public.requirement_status where person_id = (select person from t_ids);
insert into t_results (step, ok, detail) select 'person licence shows the person''s name', bool_and(subject_name = 'Juan Driver' and subject = 'person'), string_agg(subject_name, ',')
  from public.requirement_status where person_id = (select person from t_ids);
select public.add_requirement('person', person, null, 'health_certificate') from t_ids;
insert into t_results (step, ok, detail) select 'add_requirement works for people', count(*) = 3, count(*)::text
  from public.requirements where person_id = (select person from t_ids) and deleted_at is null;

update t_ids set ord = public.request_service(org, 'renew_mayors_permit', req, null, null, null, 'Please renew', false, 'phone', '0917');
insert into t_results (step, ok, detail) select 'order snapshots permit + business', requirement_name = 'Mayor''s / Business Permit' and subject_label = 'Bea Store'
  and business_id = (select biz from t_ids) and status = 'submitted' and payment_status = 'unpaid', requirement_name || ' / ' || subject_label || ' / ' || status
  from public.assistance_requests where id = (select ord from t_ids);
insert into t_results (step, ok, detail) select 'timeline starts with "created"', count(*) = 1, string_agg(kind, ',')
  from public.request_events where request_id = (select ord from t_ids) and kind = 'created';
update t_ids set ord2 = public.request_service(org, 'pkg_new_branch', null, biz, null, null, 'Opening in Pasig', true);
insert into t_results (step, ok, detail) select 'package order without a permit works', requirement_name = 'New branch opening' and rush, requirement_name
  from public.assistance_requests where id = (select ord2 from t_ids);
do $$ begin
  perform public.accept_quote((select ord from t_ids));
  insert into t_results (step, ok, detail) values ('cannot accept before a quote exists', false, 'was allowed');
exception when others then insert into t_results (step, ok, detail) values ('cannot accept before a quote exists', true, sqlerrm); end $$;
do $$ begin
  perform public.admin_quote_request((select ord from t_ids), 1, 1, 'cheap');
  insert into t_results (step, ok, detail) values ('customer cannot quote themselves', false, 'was allowed');
exception when others then insert into t_results (step, ok, detail) values ('customer cannot quote themselves', true, sqlerrm); end $$;
do $$ begin
  update public.assistance_requests set payment_status = 'paid', quote_php = 0 where id = (select ord from t_ids);
  insert into t_results (step, ok, detail) select 'direct update cannot mark paid', payment_status = 'unpaid', payment_status from public.assistance_requests where id = (select ord from t_ids);
end $$;
reset role;

insert into t_results (step, ok, detail) select 'founder alerted about the new order', count(*) >= 2, count(*)::text
  from public.notifications where user_id = '77777777-7777-7777-7777-777777777777' and title like 'New request:%';

-- ---------------------------------------------------------------- founder quotes
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
set local role authenticated;
select public.admin_quote_request(ord, 2500, 4200, 'Gov fees based on last year') from t_ids;
insert into t_results (step, ok, detail) select 'quote sets total and status', quote_php = 6700 and status = 'quoted', quote_php::text || ' ' || status
  from public.assistance_requests where id = (select ord from t_ids);
reset role;
insert into t_results (step, ok, detail) select 'customer told the quote is ready', count(*) = 1, string_agg(title, ',')
  from public.notifications where user_id = '66666666-6666-6666-6666-666666666666' and title like '%Quote ready%';

-- ---------------------------------------------------------------- customer accepts and pays by GCash
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
select public.accept_quote(ord) from t_ids;
insert into t_results (step, ok, detail) select 'accepting asks for payment', payment_status = 'awaiting_payment' and status = 'awaiting_customer', payment_status || ' ' || status
  from public.assistance_requests where id = (select ord from t_ids);
select public.submit_payment(ord, 'gcash', 'GC-123456', null, null) from t_ids;
insert into t_results (step, ok, detail) select 'payment waits for checking', payment_status = 'pending_verification', payment_status
  from public.assistance_requests where id = (select ord from t_ids);
do $$ begin
  perform public.admin_confirm_payment((select ord from t_ids), true, null);
  insert into t_results (step, ok, detail) values ('customer cannot confirm own payment', false, 'was allowed');
exception when others then insert into t_results (step, ok, detail) values ('customer cannot confirm own payment', true, sqlerrm); end $$;
reset role;

-- ---------------------------------------------------------------- stranger sees nothing
select set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}', true);
set local role authenticated;
insert into t_results (step, ok, detail) select 'stranger cannot see orders or timeline',
  (select count(*) from public.assistance_requests where id = (select ord from t_ids)) = 0
  and (select count(*) from public.request_events where request_id = (select ord from t_ids)) = 0, 'checked';
do $$ begin
  perform public.submit_payment((select ord from t_ids), 'gcash', 'X', null, null);
  insert into t_results (step, ok, detail) values ('stranger cannot touch the order', false, 'was allowed');
exception when others then insert into t_results (step, ok, detail) values ('stranger cannot touch the order', true, sqlerrm); end $$;
insert into t_results (step, ok, detail) select 'stranger cannot see people', count(*) = 0, count(*)::text from public.people where id = (select person from t_ids);
reset role;

-- ---------------------------------------------------------------- founder confirms, does the job, records the renewal
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
set local role authenticated;
select public.admin_confirm_payment(ord, true, null) from t_ids;
insert into t_results (step, ok, detail) select 'confirmed payment starts the work', payment_status = 'paid' and status = 'in_progress', payment_status || ' ' || status
  from public.assistance_requests where id = (select ord from t_ids);
select public.admin_update_order(ord, null, 'Filed at Taguig BPLO today', (select org from t_ids)::text || '/requests/x/receipt.pdf', 'receipt.pdf') from t_ids;
select public.admin_record_renewal(ord, 'MP-2027', 'Taguig BPLO', private.today_ph(), (private.today_ph() + 365), 4150, null, null, null, null) from t_ids;
reset role;
insert into t_results (step, ok, detail) select 'renewal saved to the customer''s permit', reference_no = 'MP-2027' and amount_paid = 4150 and status = 'needs_information',
  reference_no || ' ' || amount_paid || ' ' || status from public.requirement_status where id = (select req from t_ids);
insert into t_results (step, ok, detail) select 'order completed with a full timeline', a.status = 'completed' and (select count(*) from public.request_events e where e.request_id = a.id) >= 6,
  a.status || ' / ' || (select string_agg(kind, ',' order by id) from public.request_events e where e.request_id = a.id)
  from public.assistance_requests a where a.id = (select ord from t_ids);

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
insert into t_results (step, ok, detail) select 'customer sees published partner', count(*) = 1, count(*)::text from public.list_partners() where name = 'Test Insurer';
insert into t_results (step, ok, detail) select 'customer cannot read commission terms', count(*) = 0, count(*)::text from public.partners;
update t_ids set ref = public.request_referral(org, partner, null, 'Need CTPL for 2 vans', 'phone', '0917');
insert into t_results (step, ok, detail) select 'referral recorded', count(*) = 1, count(*)::text from public.referrals where id = (select ref from t_ids);
insert into t_results (step, ok, detail) select 'customer cannot see commission', count(*) = 0, count(*)::text from public.referral_commissions;
reset role;
insert into t_results (step, ok, detail) select 'commission row ready for the founder', count(*) = 1, count(*)::text from public.referral_commissions where referral_id = (select ref from t_ids);

-- ---------------------------------------------------------------- workspaces summary
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
update t_ids set other_org = public.create_org('Client Two');
insert into t_results (step, ok, detail) select 'workspace summary covers every workspace', count(*) = 2 and sum(total) >= 7, count(*) || ' / ' || sum(total)
  from public.my_workspaces();
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
