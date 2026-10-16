-- Refunds, staff file-access log, storage read rules.
-- Always ends in an exception so nothing is kept; read PASS/FAIL from the message.

create temp table t_results (n serial, step text, ok boolean, detail text) on commit drop;
grant insert, select on t_results to authenticated, anon;
grant usage on sequence t_results_n_seq to authenticated, anon;
create temp table t_ids (org uuid, biz uuid, req uuid, ord uuid, doc_path text) on commit drop;
grant all on t_ids to authenticated, anon;
insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at) values
  ('66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-000000000000','authenticated','authenticated','buyer@test.local','{"first_name":"Bea"}', now(), now(), now()),
  ('77777777-7777-7777-7777-777777777777','00000000-0000-0000-0000-000000000000','authenticated','authenticated','founder@test.local','{"first_name":"Fo"}', now(), now(), now());
update public.profiles set is_platform_admin = true where id = '77777777-7777-7777-7777-777777777777';

select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Bea Trading');
update t_ids set biz = public.create_business(org, 'Bea Store', 'Sole Proprietorship', 'retail', 'Taguig City', '');
update t_ids set req = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit');
update t_ids set doc_path = org || '/' || req || '/abc123-permit.pdf';
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, req, 'MP-1', private.today_ph() - 3 from t_ids;
insert into public.documents (org_id, requirement_id, cycle_id, file_name, storage_path, mime_type, size_bytes)
  select t.org, t.req, c.id, 'permit.pdf', t.doc_path, 'application/pdf', 100 from t_ids t join public.requirement_cycles c on c.requirement_id = t.req;
reset role;

-- staff cannot open the file before there is a request
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.staff_open_file((select doc_path from t_ids));
  insert into t_results (step, ok, detail) values ('staff blocked without an open request', false, 'was allowed');
exception when others then insert into t_results (step, ok, detail) values ('staff blocked without an open request', true, sqlerrm); end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
update t_ids set ord = public.request_service(org, 'renew_mayors_permit', req, null, null, null, 'Please renew', false, 'phone', '0917');
reset role;

select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
set local role authenticated;
insert into t_results (step, ok, detail) select 'staff can open with an open request', public.staff_open_file(doc_path) = 'permit.pdf', 'ok' from t_ids;
do $$ begin
  perform public.admin_refund_order((select ord from t_ids), 100, 'partial', 'test');
  insert into t_results (step, ok, detail) values ('no refund before payment', false, 'was allowed');
exception when others then insert into t_results (step, ok, detail) values ('no refund before payment', true, sqlerrm); end $$;
select public.admin_quote_request(ord, 2500, 4200, null) from t_ids;
reset role;

select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
insert into t_results (step, ok, detail) select 'customer sees the staff file access', count(*) = 1 and bool_and(file_name = 'permit.pdf' and reason like 'Request: %'), count(*)::text
  from public.staff_file_access;
do $$ begin
  insert into public.staff_file_access (org_id, staff_name, file_path, file_name, reason) select org, 'x', 'x', 'x', 'x' from t_ids;
  insert into t_results (step, ok, detail) values ('customer cannot write or erase the log', false, 'insert allowed');
exception when others then insert into t_results (step, ok, detail) values ('customer cannot write or erase the log', true, sqlerrm); end $$;
select public.accept_quote(ord) from t_ids;
select public.submit_payment(ord, 'gcash', 'REF1') from t_ids;
reset role;

select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
set local role authenticated;
select public.admin_confirm_payment(ord, true) from t_ids;
select public.admin_refund_order(ord, 700, 'fee_difference', 'City fee was lower than estimated', 'gcash', 'R-1') from t_ids;
insert into t_results (step, ok, detail) select 'fee-difference refund keeps the order going', status = 'in_progress' and payment_status = 'paid', status || '/' || payment_status
  from public.assistance_requests where id = (select ord from t_ids);
do $$ begin
  perform public.admin_refund_order((select ord from t_ids), 7000, 'full', 'too much');
  insert into t_results (step, ok, detail) values ('refund capped at what was paid', false, 'was allowed');
exception when others then insert into t_results (step, ok, detail) values ('refund capped at what was paid', true, sqlerrm); end $$;
select public.admin_refund_order(ord, 6000, 'full', 'We could not get the permit') from t_ids;
insert into t_results (step, ok, detail) select 'full refund cancels and marks refunded', status = 'cancelled' and payment_status = 'refunded', status || '/' || payment_status
  from public.assistance_requests where id = (select ord from t_ids);
insert into t_results (step, ok, detail) select 'staff blocked once the request is closed',
  not exists (select 1 from public.documents d join public.assistance_requests a on a.requirement_id = d.requirement_id and a.status not in ('completed','cancelled')
    where d.storage_path = (select doc_path from t_ids)), 'closed';
reset role;

select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
insert into t_results (step, ok, detail) select 'customer sees both refunds', count(*) = 2 and sum(amount_php) = 6700, sum(amount_php)::text from public.order_refunds;
insert into t_results (step, ok, detail) select 'refunds are in the order timeline', count(*) = 2, count(*)::text
  from public.request_events where request_id = (select ord from t_ids) and message like 'Refund sent%';
reset role;

do $$ declare r text; begin
  select string_agg(case when ok then 'PASS ' else 'FAIL ' end || step || coalesce(' (' || detail || ')', ''), E'\n' order by n) into r from t_results;
  raise exception E'RESULTS\n%', r;
end $$;
