-- Getting paid for quote requests: prepaid credit, firms paused at zero, no per-sale fees, no website
-- for customers, the firm's 7-day report link, staff decisions, "Did you hire them?" and the money
-- views. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (org uuid, org2 uuid, biz uuid, fsic uuid, firm uuid, flat uuid, place uuid, ref1 uuid, ref2 uuid, ref3 uuid, tok uuid, dispute uuid, topup uuid);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('c2000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@leads.ph','{"first_name":"Nena"}', now()),
 ('c2000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@leads.ph','{"first_name":"Oca"}', now()),
 ('c2000000-0000-4000-8000-0000000000f4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@leads.ph','{"first_name":"Fe"}', now());
update public.profiles set is_platform_admin = true where id = 'c2000000-0000-4000-8000-0000000000f4';

select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Nena Foods');
update t_ids set biz = public.create_business(org, 'Nena Bakery', 'Corporation', 'restaurant', 'Pasig City', '');
update t_ids set fsic = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'fsic' limit 1);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org2 = public.create_org('Other Co');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- firms
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
insert into public.partners (category, name, published, verified, fee_model, lead_fee_php, contact_email, billing_email, cities, website, type_codes)
  values ('fire_safety', 'Pasig Fire Pros', true, true, 'per_lead', 500, 'leads@firepros.ph', 'billing@firepros.ph', array['Pasig City'], 'https://firepros.ph', array['fsic']);
insert into public.partners (category, name, published, fee_model, monthly_fee_php, contact_email) values ('bookkeeping', 'Flat Books', true, 'monthly', 1500, 'hi@flatbooks.ph');
update t_ids set firm = (select id from public.partners where name = 'Pasig Fire Pros'), flat = (select id from public.partners where name = 'Flat Books');
insert into public.partner_placements (partner_id, type_code, item_key, cities, headline, starts_on, ends_on, monthly_fee_php)
  select firm, 'fsic', 'ready', '{}', 'Extinguishers refilled and tagged, same week', private.today_ph() - 1, private.today_ph() + 60, 1000 from t_ids;
update t_ids set place = (select id from public.partner_placements where partner_id = (select firm from t_ids));
do $$ begin update public.partners set fee_model = 'per_sale_flat', sale_fee_php = 700 where id = (select flat from t_ids);
  perform pg_temp.res('per-sale fees are no longer possible', false, 'was allowed');
exception when others then perform pg_temp.res('per-sale fees are no longer possible', sqlerrm like '%fee_model_check%', sqlerrm); end $$;
do $$ begin perform public.admin_add_credit((select flat from t_ids), 1000, 'GCash');
  perform pg_temp.res('credit is only for firms paid per quote request', false, 'was allowed');
exception when others then perform pg_temp.res('credit is only for firms paid per quote request', sqlerrm like 'Credit is for firms%', sqlerrm); end $$;
do $$ begin perform public.admin_add_credit((select firm from t_ids), 0, 'GCash');
  perform pg_temp.res('a top-up needs an amount', false, 'was allowed');
exception when others then perform pg_temp.res('a top-up needs an amount', sqlerrm like 'Enter the amount%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- with no credit, the per-request firm doesn't show; the flat-fee firm does
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('no credit: the firm isn''t listed, its checklist line isn''t shown',
  not exists (select 1 from public.list_professionals() where id = (select firm from t_ids))
  and not exists (select 1 from public.list_placements() where id = (select place from t_ids))
  and exists (select 1 from public.list_professionals() where id = (select flat from t_ids)), '');
do $$ begin perform public.request_referral((select org from t_ids), (select firm from t_ids), (select fsic from t_ids), 'x', 'phone', '09171234567');
  perform pg_temp.res('...and can''t be sent a request', false, 'was allowed');
exception when others then perform pg_temp.res('...and can''t be sent a request', sqlerrm like '%isn''t taking new requests%', sqlerrm); end $$;
select pg_temp.res('customers never get a firm''s website (requests go through Pinoy Permit)',
  not exists (select 1 from public.list_professionals() x where to_jsonb(x) ? 'website'), '');
do $$ begin perform public.admin_add_credit((select firm from t_ids), 5000, 'GCash');
  perform pg_temp.res('only staff add credit', false, 'was allowed');
exception when others then perform pg_temp.res('only staff add credit', sqlerrm = 'Staff only.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- the firm pays ₱1,000: 2 requests
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('a top-up adds to the balance', public.admin_add_credit(firm, 1000, 'GCash', 'GC-77', 'INV-C1') = 1000, '') from t_ids;
update t_ids set topup = (select id from public.partner_credits where partner_id = (select firm from t_ids) and kind = 'topup');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the firm gets a receipt with its balance', count(*) = 1 and bool_and(body_text like '%Credit left: ₱1,000.00 (2 more quote requests)%'), count(*)::text)
  from public.message_outbox where to_address = 'billing@firepros.ph' and dedupe_key like 'credit:%';

select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('with credit it shows again', exists (select 1 from public.list_professionals() where id = (select firm from t_ids))
  and exists (select 1 from public.list_placements() where id = (select place from t_ids)), '');
update t_ids set ref1 = public.request_referral(org, firm, fsic, 'Need extinguishers tagged', 'phone', '09171234567', place);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the request uses the fee from the credit', credit_php = 500, credit_php::text) from public.partners where id = (select firm from t_ids);
select pg_temp.res('...recorded in the credit history with the balance after it', count(*) = 1 and min(balance_php) = 500 and min(amount_php) = -500, count(*)::text)
  from public.partner_credits where referral_id = (select ref1 from t_ids) and kind = 'lead';
select pg_temp.res('no statement charge for a prepaid request', not exists (select 1 from public.partner_charges where referral_id = (select ref1 from t_ids)), '');
select pg_temp.res('the lead email says what it used, what''s left, and has the report link', count(*) = 1
  and bool_and(body_text like '%used ₱500.00 of your Pinoy Permit credit%' and body_text like '%Credit left: ₱500.00 (1 more quote request)%' and body_text like '%#/lead/%'), count(*)::text)
  from public.message_outbox where to_address = 'leads@firepros.ph' and dedupe_key = 'lead:' || (select ref1 from t_ids);
select pg_temp.res('one request left: the firm is told it''s running low', count(*) = 1, count(*)::text)
  from public.message_outbox where to_address = 'billing@firepros.ph' and subject like '%running low%';

-- the second request takes it to zero: paused
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set ref2 = public.request_referral(org, firm, null, 'Another branch', 'phone', '09171234567');
select pg_temp.res('at zero the firm stops showing', not exists (select 1 from public.list_professionals() where id = (select firm from t_ids)), '');
do $$ begin perform public.request_referral((select org from t_ids), (select firm from t_ids), (select fsic from t_ids), 'third', 'phone', '0917');
  perform pg_temp.res('...and gets no more requests until it tops up', false, 'was allowed');
exception when others then perform pg_temp.res('...and gets no more requests until it tops up', sqlerrm like '%isn''t taking new requests%', sqlerrm); end $$;
select pg_temp.res('customers can''t see credit, reports or link tokens',
  (select count(*) from public.partner_credits) = 0 and (select count(*) from public.lead_disputes) = 0, '');
do $$ begin perform 1 from private.lead_tokens;
  perform pg_temp.res('...not even the tokens table', false, 'was allowed');
exception when others then perform pg_temp.res('...not even the tokens table', true, sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the firm is told its listing is paused, and so are you',
  (select count(*) from public.message_outbox where to_address = 'billing@firepros.ph' and subject like '%paused%') = 1
  and (select count(*) from public.notifications where user_id = 'c2000000-0000-4000-8000-0000000000f4' and title like 'Paused for no credit%') = 1, '');
select private.partner_monthly_charges();
select pg_temp.res('a paused firm''s checklist line isn''t charged this month',
  not exists (select 1 from public.partner_charges where placement_id = (select place from t_ids))
  and exists (select 1 from public.partner_charges where partner_id = (select flat from t_ids) and kind = 'listing'), '');

-- ---------------------------------------------------------------- the firm's report link (no account needed)
update t_ids set tok = (select token from private.lead_tokens where referral_id = (select ref1 from t_ids));
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.res('the link shows the firm the request, the fee and the deadline',
  (public.lead_for_firm(tok) ->> 'business') = 'Nena Foods' and (public.lead_for_firm(tok) ->> 'fee')::numeric = 500 and (public.lead_for_firm(tok) ->> 'can_report')::boolean
  and not (public.lead_for_firm(tok)::text like '%09171234567%'), '') from t_ids;
select pg_temp.res('a wrong link shows nothing', public.lead_for_firm(gen_random_uuid()) is null, '');
do $$ begin perform public.report_lead((select tok from t_ids), 'not_a_reason', null);
  perform pg_temp.res('a report needs a real reason', false, 'was allowed');
exception when others then perform pg_temp.res('a report needs a real reason', sqlerrm = 'Choose a reason.', sqlerrm); end $$;
select public.report_lead(tok, 'duplicate', 'They asked us directly last week') from t_ids;
do $$ begin perform public.report_lead((select tok from t_ids), 'spam', null);
  perform pg_temp.res('one report per request', false, 'was allowed');
exception when others then perform pg_temp.res('one report per request', sqlerrm like 'You already reported%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update t_ids set dispute = (select id from public.lead_disputes where referral_id = (select ref1 from t_ids));
select pg_temp.res('staff are told about the report', count(*) = 1, count(*)::text)
  from public.notifications where user_id = 'c2000000-0000-4000-8000-0000000000f4' and title = 'Lead reported by Pasig Fire Pros';
-- older than 7 days: too late
update public.referrals set created_at = now() - interval '8 days' where id = (select ref2 from t_ids);
update t_ids set tok = (select token from private.lead_tokens where referral_id = (select ref2 from t_ids));
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin perform public.report_lead((select tok from t_ids), 'spam', null);
  perform pg_temp.res('after 7 days a request can''t be reported', false, 'was allowed');
exception when others then perform pg_temp.res('after 7 days a request can''t be reported', sqlerrm like 'Reports are taken within 7 days%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- staff decide
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.admin_decide_dispute((select dispute from t_ids), true, null);
  perform pg_temp.res('only staff decide reports', false, 'was allowed');
exception when others then perform pg_temp.res('only staff decide reports', sqlerrm = 'Staff only.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.admin_decide_dispute((select dispute from t_ids), false, '');
  perform pg_temp.res('a decline needs a reason the firm can read', false, 'was allowed');
exception when others then perform pg_temp.res('a decline needs a reason the firm can read', sqlerrm like 'Say why%', sqlerrm); end $$;
do $$ declare s jsonb := public.admin_money_summary(); begin
  perform pg_temp.res('Money counts the open report, the paused firm and the credit held',
    (s ->> 'disputes_open')::int = 1 and (s ->> 'firms_paused')::int >= 1 and (s ->> 'credit_held')::numeric = 0, s ->> 'disputes_open');
end $$;
select public.admin_decide_dispute(dispute, true, null) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('accepted: the fee goes back on the credit', credit_php = 500, credit_php::text) from public.partners where id = (select firm from t_ids);
select pg_temp.res('...shown in the credit history', count(*) = 1, count(*)::text) from public.partner_credits where referral_id = (select ref1 from t_ids) and kind = 'refund' and amount_php = 500;
select pg_temp.res('...the firm is emailed, and it shows again', (select count(*) from public.message_outbox where to_address = 'billing@firepros.ph' and subject like 'Report accepted%') = 1
  and (select private.partner_live(p) from public.partners p where p.id = (select firm from t_ids)), '');
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.admin_decide_dispute((select dispute from t_ids), true, null);
  perform pg_temp.res('a report is decided once', false, 'was allowed');
exception when others then perform pg_temp.res('a report is decided once', sqlerrm like '%already decided%', sqlerrm); end $$;
do $$ begin perform public.admin_adjust_credit((select firm from t_ids), -900, 'Refund to the firm');
  perform pg_temp.res('an adjustment can''t take credit below zero', false, 'was allowed');
exception when others then perform pg_temp.res('an adjustment can''t take credit below zero', sqlerrm like 'They only have%', sqlerrm); end $$;
select pg_temp.res('an adjustment with a reason changes the balance', public.admin_adjust_credit(firm, 250, 'Goodwill credit') = 750, '') from t_ids;
select public.admin_set_invoice_no('credit', topup, 'INV-C9') from t_ids;
select pg_temp.res('a top-up gets its BIR invoice number', bir_invoice_no = 'INV-C9', bir_invoice_no) from public.partner_credits where id = (select topup from t_ids);
create temp table t_money as select * from public.admin_money(private.today_ph() - 5, private.today_ph());
select pg_temp.res('Money counts the top-up as money in, once', (select count(*) from t_money where kind = 'credit_topup' and amount = 1000 and state = 'collected') = 1
  and not exists (select 1 from t_money where label like 'Quote request from Nena%'), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- "Did you hire them?"
update public.referrals set created_at = now() - interval '9 days' where id = (select ref1 from t_ids);
select pg_temp.res('a week on, the customer is asked once', private.referral_followups() >= 1, '');
select pg_temp.res('...with a notification', (select count(*) from public.notifications where user_id = 'c2000000-0000-4000-8000-0000000000a1' and title = 'Did you hire Pasig Fire Pros?') >= 1, '');
select pg_temp.res('...and not again', private.referral_followups() = 0, '');
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.answer_referral((select ref1 from t_ids), true);
  perform pg_temp.res('another workspace can''t answer', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace can''t answer', sqlerrm like '%not found%', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.answer_referral(ref1, true) from t_ids;
select public.answer_referral(ref2, false) from t_ids;
select pg_temp.res('the customer''s answers are saved', (select status from public.referrals where id = (select ref1 from t_ids)) = 'converted'
  and (select status from public.referrals where id = (select ref2 from t_ids)) = 'not_converted'
  and (select outcome_at is not null from public.referrals where id = (select ref1 from t_ids)), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
