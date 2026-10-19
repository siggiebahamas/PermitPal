-- Getting paid for every quote request PermitPal sends a firm, even when the firm and the customer then
-- deal with each other directly. PermitPal only charges for what it can show happened: a request sent
-- through PermitPal, logged with the business and the time.
--   1) Per quote request, prepaid. A firm buys credit; each request uses its fee; when the credit can't
--      cover one more, the firm stops showing until it tops up. No statements to chase for leads.
--   2) No per-sale fees. A sale happens outside PermitPal and can't be proven, so it isn't billed.
--   3) No website link for customers: requests go through PermitPal, where they're logged.
--   4) A 7-day window: from the link in each lead email the firm can report it (spam, a duplicate, can't be
--      reached, not their service). Staff decide; an accepted report puts the fee back on their credit.
--   5) "Did you hire them?": a week after a request the customer is asked once, and can answer anytime.
--   6) A flat monthly listing stays for firms that won't pay per request.

-- ---------------------------------------------------------------- 2) per-sale fees end
-- Firms on them are set to "no fee" until staff agree a new one (they're shown in Admin > Professionals).
update public.partners set fee_model = 'none' where fee_model in ('per_sale_flat','per_sale_percent');
alter table public.partners drop constraint if exists partners_fee_model_check;
alter table public.partners add constraint partners_fee_model_check check (fee_model in ('per_lead','monthly','none'));

-- ---------------------------------------------------------------- 1) prepaid credit
alter table public.partners add column if not exists credit_php numeric(12,2) not null default 0 check (credit_php >= 0);

-- Every peso in and out of a firm's credit, with the balance after it.
create table if not exists public.partner_credits (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid not null references public.partners(id) on delete restrict,
  kind           text not null check (kind in ('topup','lead','refund','adjust')),
  amount_php     numeric(12,2) not null check (amount_php <> 0),
  balance_php    numeric(12,2) not null check (balance_php >= 0),
  referral_id    uuid references public.referrals(id) on delete set null,
  note           text check (note is null or length(note) <= 300),
  paid_method    text check (paid_method is null or length(paid_method) <= 60),
  paid_ref       text check (paid_ref is null or length(paid_ref) <= 120),
  bir_invoice_no text check (bir_invoice_no is null or length(bir_invoice_no) <= 60),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists partner_credits_partner on public.partner_credits(partner_id, created_at desc);
create unique index if not exists partner_credits_lead on public.partner_credits(referral_id) where kind = 'lead';
create unique index if not exists partner_credits_refund on public.partner_credits(referral_id) where kind = 'refund';
alter table public.partner_credits enable row level security;
drop policy if exists partner_credits_admin on public.partner_credits;
create policy partner_credits_admin on public.partner_credits for select to authenticated using ((select private.is_platform_admin()));
revoke insert, update, delete on public.partner_credits from anon, authenticated;
revoke all on public.partner_credits from anon;

-- A firm shows to customers when it's published and, if it pays per request, has credit for one more.
create or replace function private.partner_live(p public.partners) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p.published, false) and (p.fee_model <> 'per_lead' or coalesce(p.lead_fee_php, 0) = 0 or p.credit_php >= p.lead_fee_php)
$$;

-- "Credit left: ₱4,500 (9 more quote requests)"
create or replace function private.credit_line(p public.partners) returns text
language sql stable set search_path = '' as $$
  select 'Credit left: ' || private.peso(p.credit_php) ||
    case when p.fee_model = 'per_lead' and coalesce(p.lead_fee_php, 0) > 0
      then ' (' || floor(p.credit_php / p.lead_fee_php)::int || ' more quote request' || case when floor(p.credit_php / p.lead_fee_php) = 1 then '' else 's' end || ')'
      else '' end
$$;

-- An email to a firm about its account (to its billing email if it has one).
create or replace function private.firm_email(p public.partners, p_subject text, p_body text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_to text := coalesce(nullif(btrim(p.billing_email), ''), nullif(btrim(p.contact_email), ''));
begin
  if v_to is null then return; end if;
  if exists (select 1 from public.message_outbox where dedupe_key = p_key) then return; end if;
  insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
  values (null, 'email', v_to, p_subject, p_body,
    private.email_html(p_subject, '<p style="white-space:pre-line">' || private.html_escape(p_body) || '</p>', null, null), p_key);
end $$;
revoke all on function private.firm_email(public.partners, text, text, text) from public, anon, authenticated;

-- Staff: a firm paid for credit (GCash or bank transfer). Emails them a receipt with their balance.
create or replace function public.admin_add_credit(p_partner uuid, p_amount numeric, p_method text, p_ref text default null, p_invoice_no text default null) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_p public.partners; v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_p from public.partners where id = p_partner for update;
  if v_p.id is null then raise exception 'Firm not found.' using errcode = 'P0002'; end if;
  if v_p.fee_model <> 'per_lead' or coalesce(v_p.lead_fee_php, 0) = 0 then
    raise exception 'Credit is for firms that pay per quote request. Set their fee first.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'Enter the amount they paid, from ₱1 to ₱1,000,000.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_method, ''))) = 0 then raise exception 'Say how they paid (GCash, bank transfer).' using errcode = '22023'; end if;
  update public.partners set credit_php = credit_php + round(p_amount, 2) where id = p_partner returning * into v_p;
  insert into public.partner_credits (partner_id, kind, amount_php, balance_php, note, paid_method, paid_ref, bir_invoice_no)
  values (p_partner, 'topup', round(p_amount, 2), v_p.credit_php, 'Prepaid credit', btrim(p_method), nullif(btrim(p_ref), ''), nullif(btrim(p_invoice_no), ''))
  returning id into v_id;
  perform private.firm_email(v_p, 'PermitPal credit added: ' || private.peso(p_amount),
    'Thank you. We received ' || private.peso(p_amount) || ' by ' || btrim(p_method) || coalesce(' (ref ' || nullif(btrim(p_ref), '') || ')', '') || '.' || E'\n\n' ||
    private.credit_line(v_p) || '.' || E'\n' ||
    case when private.partner_live(v_p) then 'Your listing is showing to customers.' else 'Your listing shows once we publish it.' end || E'\n\n' ||
    'Each quote request we send you uses ' || private.peso(v_p.lead_fee_php) || ' of your credit, whether or not you get the job. ' ||
    'If a request is spam, a duplicate, can''t be reached or isn''t something you do, report it within 7 days with the link in that email and we put the fee back.',
    'credit:' || v_id);
  return v_p.credit_php;
end $$;

-- Staff: correct a balance, or record credit refunded to a firm that leaves (never below ₱0).
create or replace function public.admin_adjust_credit(p_partner uuid, p_amount numeric, p_note text) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_p public.partners;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'Enter the change in pesos (minus to take off).' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Say why (kept with the firm''s credit history).' using errcode = '22023'; end if;
  select * into v_p from public.partners where id = p_partner for update;
  if v_p.id is null then raise exception 'Firm not found.' using errcode = 'P0002'; end if;
  if v_p.credit_php + p_amount < 0 then raise exception 'They only have % in credit.', private.peso(v_p.credit_php) using errcode = 'P0001'; end if;
  update public.partners set credit_php = credit_php + round(p_amount, 2) where id = p_partner returning * into v_p;
  insert into public.partner_credits (partner_id, kind, amount_php, balance_php, note) values (p_partner, 'adjust', round(p_amount, 2), v_p.credit_php, left(btrim(p_note), 300));
  return v_p.credit_php;
end $$;

-- ---------------------------------------------------------------- 4) the firm's link, and reports
-- The link in each lead email. Kept out of the referrals table so customers never see it.
create table if not exists private.lead_tokens (
  referral_id uuid primary key references public.referrals(id) on delete cascade,
  token       uuid not null unique default gen_random_uuid()
);
insert into private.lead_tokens (referral_id) select id from public.referrals on conflict do nothing;

create table if not exists public.lead_disputes (
  id            uuid primary key default gen_random_uuid(),
  referral_id   uuid not null unique references public.referrals(id) on delete cascade,
  partner_id    uuid not null references public.partners(id) on delete restrict,
  reason        text not null check (reason in ('spam','duplicate','unreachable','not_our_service')),
  note          text check (note is null or length(note) <= 500),
  status        text not null default 'open' check (status in ('open','accepted','declined')),
  credited_php  numeric(12,2) not null default 0,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users(id) on delete set null
);
alter table public.lead_disputes enable row level security;
drop policy if exists lead_disputes_admin on public.lead_disputes;
create policy lead_disputes_admin on public.lead_disputes for select to authenticated using ((select private.is_platform_admin()));
revoke insert, update, delete on public.lead_disputes from anon, authenticated;
revoke all on public.lead_disputes from anon;

-- What the firm sees from its link: no customer contact details (they already have them by email).
create or replace function public.lead_for_firm(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_r public.referrals; v_d public.lead_disputes; v_firm text; v_org text; v_req text; v_fee numeric;
begin
  select r.* into v_r from private.lead_tokens t join public.referrals r on r.id = t.referral_id where t.token = p_token;
  if v_r.id is null then return null; end if;
  select name into v_firm from public.partners where id = v_r.partner_id;
  select name into v_org from public.orgs where id = v_r.org_id;
  select rs.name || coalesce(' · ' || nullif(rs.subject_name, ''), '') || coalesce(', ' || nullif(rs.location_city, ''), '') into v_req
    from public.requirement_status rs where rs.id = v_r.requirement_id;
  select coalesce(-sum(amount_php), 0) into v_fee from public.partner_credits where referral_id = v_r.id and kind = 'lead';
  select * into v_d from public.lead_disputes where referral_id = v_r.id;
  return jsonb_build_object('firm', v_firm, 'business', v_org, 'permit', v_req, 'sent_at', v_r.created_at, 'fee', v_fee,
    'report_until', v_r.created_at + interval '7 days', 'can_report', v_d.id is null and v_r.created_at > now() - interval '7 days',
    'dispute', case when v_d.id is null then null else jsonb_build_object('reason', v_d.reason, 'status', v_d.status, 'note', v_d.decision_note, 'credited', v_d.credited_php) end);
end $$;

create or replace function public.report_lead(p_token uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_r public.referrals; v_firm text; v_org text;
begin
  select r.* into v_r from private.lead_tokens t join public.referrals r on r.id = t.referral_id where t.token = p_token;
  if v_r.id is null then raise exception 'This link isn''t valid.' using errcode = 'P0002'; end if;
  if coalesce(p_reason, '') not in ('spam','duplicate','unreachable','not_our_service') then raise exception 'Choose a reason.' using errcode = '22023'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Please keep the note under 500 characters.' using errcode = '22023'; end if;
  if v_r.created_at <= now() - interval '7 days' then
    raise exception 'Reports are taken within 7 days of the request. This one was sent on %.', private.fmt_date(private.ph_day(v_r.created_at)) using errcode = 'P0001';
  end if;
  if exists (select 1 from public.lead_disputes where referral_id = v_r.id) then raise exception 'You already reported this request. We''ll email you our decision.' using errcode = 'P0001'; end if;
  insert into public.lead_disputes (referral_id, partner_id, reason, note) values (v_r.id, v_r.partner_id, p_reason, nullif(btrim(p_note), ''));
  select name into v_firm from public.partners where id = v_r.partner_id;
  select name into v_org from public.orgs where id = v_r.org_id;
  perform private.notify_admins('Lead reported by ' || v_firm,
    'The request from ' || coalesce(v_org, 'a customer') || ' was reported as ' ||
    case p_reason when 'spam' then 'spam' when 'duplicate' then 'a duplicate' when 'unreachable' then 'unreachable' else 'not their service' end ||
    coalesce(': "' || nullif(btrim(p_note), '') || '"', '') || '. Decide in Admin > Partner billing.', 'dispute:' || v_r.id, true);
end $$;

-- Staff decide. Accepted: the fee goes back on the firm's credit (a lead from before prepaid credit:
-- its charge is dropped if not billed yet, otherwise credited). Either way the firm is told why.
create or replace function public.admin_decide_dispute(p_dispute uuid, p_accept boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_d public.lead_disputes; v_p public.partners; v_fee numeric := 0; v_c public.partner_charges; v_org text; v_credit boolean := false;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_d from public.lead_disputes where id = p_dispute for update;
  if v_d.id is null then raise exception 'Report not found.' using errcode = 'P0002'; end if;
  if v_d.status <> 'open' then raise exception 'This report was already decided.' using errcode = 'P0001'; end if;
  if p_accept is null then raise exception 'Accept or decline.' using errcode = '22023'; end if;
  if not p_accept and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Say why, in a sentence the firm will read.' using errcode = '22023'; end if;
  select * into v_p from public.partners where id = v_d.partner_id for update;
  if p_accept then
    select -amount_php into v_fee from public.partner_credits where referral_id = v_d.referral_id and kind = 'lead';
    if coalesce(v_fee, 0) > 0 then
      v_credit := true;
    else
      select * into v_c from public.partner_charges where referral_id = v_d.referral_id and kind = 'lead';
      v_fee := coalesce(v_c.amount_php, 0);
      if v_c.id is not null and v_c.status = 'unbilled' then update public.partner_charges set status = 'waived' where id = v_c.id;
      elsif v_c.id is not null and v_c.status in ('billed','paid') then v_credit := true;
      else v_fee := 0; end if;
    end if;
    if v_credit and v_fee > 0 then
      update public.partners set credit_php = credit_php + v_fee where id = v_p.id returning * into v_p;
      insert into public.partner_credits (partner_id, kind, amount_php, balance_php, referral_id, note)
      values (v_p.id, 'refund', v_fee, v_p.credit_php, v_d.referral_id, 'Credit back: reported lead accepted');
    end if;
    update public.referral_commissions set status = 'none', note = 'Reported by the firm and accepted' where referral_id = v_d.referral_id;
  end if;
  update public.lead_disputes set status = case when p_accept then 'accepted' else 'declined' end, credited_php = coalesce(v_fee, 0),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by = auth.uid() where id = p_dispute;
  select o.name into v_org from public.referrals r join public.orgs o on o.id = r.org_id where r.id = v_d.referral_id;
  perform private.firm_email(v_p,
    case when p_accept and v_fee > 0 then 'Report accepted: ' || private.peso(v_fee) || ' back on your PermitPal credit'
         when p_accept then 'Report accepted' else 'About the quote request you reported' end,
    'Your report on the quote request from ' || coalesce(v_org, 'a customer') || ': ' ||
    case when p_accept then 'accepted.' || case when v_fee > 0 and v_credit then ' We put ' || private.peso(v_fee) || ' back on your credit. ' || private.credit_line(v_p) || '.'
                                                when v_fee > 0 then ' We removed the ' || private.peso(v_fee) || ' charge.' else '' end
         else 'not accepted.' end || coalesce(E'\n\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
    'dispute-decided:' || p_dispute);
end $$;

-- ---------------------------------------------------------------- 5) "Did you hire them?"
alter table public.referrals
  add column if not exists asked_outcome_at timestamptz,
  add column if not exists outcome_at timestamptz;

create or replace function public.answer_referral(p_referral uuid, p_hired boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_hired is null then raise exception 'Choose yes or no.' using errcode = '22023'; end if;
  update public.referrals set status = case when p_hired then 'converted' else 'not_converted' end, outcome_at = now()
    where id = p_referral and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'Quote request not found.' using errcode = 'P0002'; end if;
end $$;

-- Asked once, a week after the request (and not for requests older than 45 days).
create or replace function private.referral_followups() returns int
language plpgsql security definer set search_path = '' as $$
declare v record; v_n int := 0;
begin
  for v in select r.id, r.org_id, r.created_by, p.name as firm from public.referrals r join public.partners p on p.id = r.partner_id
           where r.status in ('requested','introduced') and r.asked_outcome_at is null and r.outcome_at is null and r.created_by is not null
             and r.created_at < now() - interval '7 days' and r.created_at > now() - interval '45 days' loop
    perform private.notify(v.created_by, v.org_id, 'system', 'Did you hire ' || v.firm || '?',
      'One tap on Find a professional tells us. It helps us keep only firms that do good work listed.', '#/pros', null, 'refask:' || v.id, true);
    update public.referrals set asked_outcome_at = now() where id = v.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.referral_followups() from public, anon, authenticated;

-- ---------------------------------------------------------------- 1) + 4) a quote request, paid from credit
create or replace function public.request_referral(p_org uuid, p_partner uuid, p_requirement uuid default null, p_note text default null,
  p_contact_method text default 'email', p_contact_value text default null, p_placement uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_partner public.partners; v_org text; v_who text; v_req text; v_body text; v_fee numeric := 0; v_pl uuid; v_token uuid;
  v_pay text;
begin
  if p_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_partner from public.partners where id = p_partner for update;
  if v_partner.id is null or not private.partner_live(v_partner) then
    raise exception 'That professional isn''t taking new requests right now. Please choose another.' using errcode = '23503';
  end if;
  if p_requirement is not null then
    select rs.name || ' for ' || coalesce(rs.subject_name, '') || coalesce(', ' || nullif(rs.location_city, ''), '') ||
           case when rs.expires_on is not null then ' (expires ' || private.fmt_date(rs.expires_on) || ')' else '' end
      into v_req from public.requirement_status rs where rs.id = p_requirement and rs.org_id = p_org;
    if v_req is null then raise exception 'That permit was not found.' using errcode = '23503'; end if;
  end if;
  if exists (select 1 from public.referrals where org_id = p_org and partner_id = p_partner and coalesce(requirement_id::text, '') = coalesce(p_requirement::text, '')
             and created_at > now() - interval '7 days') then
    raise exception 'You already sent this request this week. They will contact you soon.' using errcode = 'P0001';
  end if;
  select id into v_pl from public.partner_placements where id = p_placement and partner_id = p_partner;
  insert into public.referrals (org_id, partner_id, requirement_id, note, contact_method, contact_value, placement_id)
  values (p_org, p_partner, p_requirement, nullif(btrim(p_note), ''), coalesce(p_contact_method, 'email'), nullif(btrim(p_contact_value), ''), v_pl)
  returning id into v_id;
  insert into private.lead_tokens (referral_id) values (v_id) returning token into v_token;
  if v_partner.fee_model = 'per_lead' then v_fee := coalesce(v_partner.lead_fee_php, 0); end if;
  insert into public.referral_commissions (referral_id, amount_php, status) values (v_id, v_fee, case when v_fee > 0 then 'paid' else 'none' end);
  select name into v_org from public.orgs where id = p_org;
  if v_fee > 0 then
    update public.partners set credit_php = credit_php - v_fee where id = p_partner returning * into v_partner;
    insert into public.partner_credits (partner_id, kind, amount_php, balance_php, referral_id, note)
    values (p_partner, 'lead', -v_fee, v_partner.credit_php, v_id, left('Quote request from ' || v_org || coalesce(' (' || split_part(v_req, ' (expires', 1) || ')', ''), 300));
  end if;
  if v_pl is not null then
    insert into private.placement_stats (placement_id, day, leads) values (v_pl, private.today_ph(), 1)
    on conflict (placement_id, day) do update set leads = private.placement_stats.leads + 1;
  end if;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) into v_who from public.profiles where id = auth.uid();
  v_body := 'New quote request from PermitPal.' || E'\n\n' || 'Business: ' || v_org || E'\n' || 'Name: ' || coalesce(v_who, '-') || E'\n' ||
    'Contact via ' || coalesce(p_contact_method, 'email') || ': ' || coalesce(p_contact_value, '-') || E'\n' ||
    coalesce('Permit: ' || v_req || E'\n', '') || coalesce('Message: ' || nullif(btrim(p_note), '') || E'\n', '') ||
    E'\nPlease contact them directly within 1 business day.' ||
    case when v_fee > 0 then E'\n\n' || 'This request used ' || private.peso(v_fee) || ' of your PermitPal credit. ' || private.credit_line(v_partner) || '.' else '' end ||
    E'\n\n' || 'Not a real lead (spam, a duplicate, can''t be reached, or not something you do)? Report it within 7 days' ||
    case when v_fee > 0 then ' and we put the fee back' else '' end || ': ' || private.setting('app_url') || '#/lead/' || v_token;
  if coalesce(v_partner.contact_email, '') <> '' then
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    values (null, 'email', v_partner.contact_email, 'New quote request: ' || v_org,
      v_body, private.email_html('New quote request from PermitPal', '<p style="white-space:pre-line">' || private.html_escape(v_body) || '</p>', 'Report this lead', private.setting('app_url') || '#/lead/' || v_token),
      'lead:' || v_id);
  end if;
  -- Running low: one more request left, or none (then the firm stops showing until it tops up).
  if v_fee > 0 and v_partner.credit_php < v_fee * 2 then
    v_pay := (select string_agg(value, ' · ') from public.app_settings where key in ('gcash_name','gcash_number','bank_name','bank_account_name','bank_account_number') and value <> '');
    perform private.firm_email(v_partner,
      case when v_partner.credit_php < v_fee then 'Your PermitPal listing is paused: add credit' else 'Your PermitPal credit is running low' end,
      private.credit_line(v_partner) || '.' || E'\n' ||
      case when v_partner.credit_php < v_fee then 'Customers can''t send you quote requests until you top up.'
           else 'After one more quote request your listing pauses until you top up.' end || E'\n\n' ||
      'To top up, pay by GCash or bank transfer and reply to this email with the reference number.' || coalesce(E'\n' || v_pay, ''),
      'credlow:' || p_partner || ':' || v_id);
    if v_partner.credit_php < v_fee then
      perform private.notify_admins('Paused for no credit: ' || v_partner.name,
        'They have ' || private.peso(v_partner.credit_php) || ' left, less than one quote request. Add credit in Admin > Professionals when they pay.', 'paused:' || v_id, false);
    end if;
  end if;
  perform private.notify_admins('Lead sent to ' || v_partner.name, v_org || ' - ' || coalesce(v_req, 'general request'), 'ref:' || v_id, false);
  return v_id;
end $$;

-- ---------------------------------------------------------------- 3) what customers see of firms (no website)
drop function if exists public.list_professionals();
create function public.list_professionals() returns table (
  id uuid, category text, name text, description text, services text, licence text, coverage text, cities text[], type_codes text[], verified boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.category, p.name, p.description, p.services, p.licence, p.coverage, p.cities, p.type_codes, p.verified
  from public.partners p where private.partner_live(p) order by p.verified desc, p.sort, p.name
$$;

-- Checklist lines only for firms that can take a request.
create or replace function public.list_placements() returns table (
  id uuid, partner_id uuid, partner_name text, category text, verified boolean, type_code text, item_key text, cities text[], headline text)
language sql stable security definer set search_path = '' as $$
  select pl.id, p.id, p.name, p.category, p.verified, pl.type_code, pl.item_key, pl.cities, pl.headline
  from public.partner_placements pl join public.partners p on p.id = pl.partner_id
  where pl.active and private.partner_live(p) and private.today_ph() between pl.starts_on and pl.ends_on
  order by pl.created_at
$$;

-- A paused firm's checklist line isn't showing, so it isn't charged for that month.
create or replace function private.partner_monthly_charges() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_month date := date_trunc('month', private.today_ph())::date; v_n int; v_m int;
begin
  insert into public.partner_charges (partner_id, kind, description, amount_php, placement_id, period, occurred_on)
  select pl.partner_id, 'placement', 'Featured on the "' || t.name || '" checklist, ' || to_char(v_month, 'FMMonth YYYY') ||
      case when cardinality(pl.cities) > 0 then ' (' || array_to_string(pl.cities, ', ') || ')' else '' end,
    pl.monthly_fee_php, pl.id, v_month, greatest(v_month, pl.starts_on)
  from public.partner_placements pl join public.requirement_types t on t.code = pl.type_code
  join public.partners p on p.id = pl.partner_id
  where pl.active and private.partner_live(p) and pl.monthly_fee_php > 0 and pl.starts_on <= v_today and pl.ends_on >= v_month
  on conflict (placement_id, period) where kind = 'placement' do nothing;
  get diagnostics v_n = row_count;
  insert into public.partner_charges (partner_id, kind, description, amount_php, period, occurred_on)
  select p.id, 'listing', 'PermitPal listing, ' || to_char(v_month, 'FMMonth YYYY'), p.monthly_fee_php, v_month, v_month
  from public.partners p where p.published and p.fee_model = 'monthly' and coalesce(p.monthly_fee_php, 0) > 0
  on conflict (partner_id, period) where kind = 'listing' do nothing;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;

-- Money: prepaid credit is money in.
create or replace function public.admin_money(p_from date, p_to date) returns table (
  day date, stream text, kind text, state text, amount numeric, label text, who text, ref_kind text, ref_id uuid, invoice_no text, rush numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'Choose a range of up to about 2 years.' using errcode = '22023'; end if;
  return query
  with lines as (
    -- one-time jobs and care renewals: our fee (service + rush), when paid
    select private.ph_day(a.paid_at) as day, 'jobs'::text as stream, 'service_fee'::text as kind, 'collected'::text as state,
      (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric as amount, a.requirement_name as label, o.name as who,
      'order'::text as ref_kind, a.id as ref_id, a.bir_invoice_no as invoice_no, a.quote_rush_fee::numeric as rush
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(a.paid_at), 'jobs', 'gov_fees_in', 'held', coalesce(a.quote_gov_fees, 0)::numeric, a.requirement_name, o.name, 'order', a.id, a.bir_invoice_no, 0::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and coalesce(a.quote_gov_fees, 0) > 0
    union all
    select private.ph_day(coalesce(a.closed_at, a.updated_at)), 'jobs', 'gov_fees_out', 'held', -a.gov_fees_actual::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and coalesce(a.gov_fees_actual, 0) > 0
    union all
    -- refunds: a fee difference is government money going back; a full refund returns our fee first, then the rest
    select private.ph_day(r.created_at), 'jobs', 'refund', 'held', -r.amount_php::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id where r.kind = 'fee_difference'
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'collected', -r.amount_php::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id where r.kind = 'partial'
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'collected', -least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric,
      a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id
    where r.kind = 'full' and least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'held', -(r.amount_php - least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee))::numeric,
      a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id
    where r.kind = 'full' and r.amount_php > coalesce(a.quote_service_fee, 0) + a.quote_rush_fee
    union all
    -- accepted, not paid yet / quoted, not accepted yet
    select private.ph_day(coalesce(a.accepted_at, a.quoted_at, a.created_at)), 'jobs', 'service_fee', 'to_collect',
      (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric, a.requirement_name, o.name, 'order', a.id, null, a.quote_rush_fee::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.payment_status in ('awaiting_payment','pending_verification') and a.status <> 'cancelled' and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(a.quoted_at), 'jobs', 'service_fee', 'pipeline', (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric, a.requirement_name, o.name,
      'order', a.id, null, a.quote_rush_fee::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.status = 'quoted' and a.quoted_at is not null and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    -- year-round care bills
    select private.ph_day(i.paid_at), 'care', 'care_fee', 'collected', i.amount_php::numeric, 'Year-round care, bill ' || i.number, o.name, 'care', i.id, i.bir_invoice_no, 0
    from public.care_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0
    union all
    select i.due_on, 'care', 'care_fee', 'to_collect', i.amount_php::numeric, 'Year-round care, bill ' || i.number, o.name, 'care', i.id, null, 0
    from public.care_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
    union all
    select private.ph_day(g.paid_at), 'care', 'guarantee', 'cost', -g.approved_php::numeric, 'On-time guarantee: ' || g.requirement_name, o.name, 'claim', g.id, null, 0
    from public.guarantee_claims g join public.orgs o on o.id = g.org_id where g.status = 'paid'
    union all
    select private.ph_day(g.decided_at), 'care', 'guarantee', 'to_pay', -g.approved_php::numeric, 'On-time guarantee: ' || g.requirement_name, o.name, 'claim', g.id, null, 0
    from public.guarantee_claims g join public.orgs o on o.id = g.org_id where g.status = 'approved'
    union all
    -- fees from firms, charge by charge
    select case when c.status = 'paid' then coalesce(private.ph_day(s.paid_at), c.occurred_on) else c.occurred_on end, 'partners', c.kind,
      case c.status when 'paid' then 'collected' when 'billed' then 'to_collect' else 'unbilled' end,
      c.amount_php::numeric, c.description, p.name, case when s.id is not null then 'statement' else 'partner' end, coalesce(s.id, p.id), s.bir_invoice_no, 0
    from public.partner_charges c join public.partners p on p.id = c.partner_id left join public.partner_statements s on s.id = c.statement_id
    where c.status <> 'waived'
    union all
    -- prepaid credit firms bought (the money is in when they pay; each quote request then uses some of it)
    select private.ph_day(c.created_at), 'partners', 'credit_topup', 'collected', c.amount_php::numeric, 'Prepaid credit for quote requests', p.name, 'credit', c.id, c.bir_invoice_no, 0
    from public.partner_credits c join public.partners p on p.id = c.partner_id where c.kind = 'topup'
    union all
    -- team plans (online, or recorded by staff)
    select private.ph_day(pm.paid_at), 'plans', 'team_plan', 'collected', pm.amount_php::numeric, pl.name || ' plan, ' || pm.months || ' month' || case when pm.months > 1 then 's' else '' end,
      o.name, 'plan', pm.id, pm.bir_invoice_no, 0
    from public.payments pm join public.orgs o on o.id = pm.org_id join public.plans pl on pl.id = pm.plan_id
    where pm.status = 'paid' and pm.plan_id is not null and pm.paid_at is not null
  )
  select l.day, l.stream, l.kind, l.state, l.amount, l.label, l.who, l.ref_kind, l.ref_id, l.invoice_no, l.rush from lines l
  where l.day between p_from and p_to or l.state in ('to_collect','pipeline','unbilled','to_pay')
  order by l.day desc, l.stream;
end $$;

create or replace function public.admin_money_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today', v_today,
    'goal', nullif(private.setting('money_goal'), '')::numeric,
    'ic_licence_no', coalesce(private.setting('ic_licence_no'), ''),
    'mrr_care', coalesce((select sum(case billing when 'monthly' then price_php else round(price_php / 12, 2) end) from public.care_plans
                          where status = 'active' and paid_through >= v_today and cancel_at is null), 0),
    'care_active', (select count(*) from public.care_plans where status = 'active' and billing <> 'per_renewal'),
    'care_autorenew', (select count(*) from public.care_plans where status = 'active' and billing = 'per_renewal'),
    'care_pending', (select count(*) from public.care_plans where status = 'pending'),
    'care_paused', (select count(*) from public.care_plans where status = 'paused'),
    'care_ending', (select count(*) from public.care_plans where status in ('active','paused') and cancel_at is not null),
    'mrr_plans', coalesce((select sum(pl.price_php_monthly) from public.orgs o join public.plans pl on pl.id = o.plan_id
                           where o.deleted_at is null and coalesce(pl.price_php_monthly, 0) > 0 and (o.plan_expires_at is null or o.plan_expires_at > now())), 0),
    'plans_paying', (select count(*) from public.orgs o join public.plans pl on pl.id = o.plan_id
                     where o.deleted_at is null and coalesce(pl.price_php_monthly, 0) > 0 and (o.plan_expires_at is null or o.plan_expires_at > now())),
    'held_gov', coalesce((select sum(coalesce(quote_gov_fees, 0)) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded')), 0)
              - coalesce((select sum(gov_fees_actual) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and gov_fees_actual is not null), 0)
              - coalesce((select sum(r.amount_php) from public.order_refunds r where r.kind = 'fee_difference'), 0)
              - coalesce((select sum(r.amount_php - least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)) from public.order_refunds r
                          join public.assistance_requests a on a.id = r.request_id where r.kind = 'full'), 0),
    'gov_unrecorded', (select count(*) from public.assistance_requests where status = 'completed' and paid_at is not null and coalesce(quote_gov_fees, 0) > 0 and gov_fees_actual is null),
    'quotes_to_send', (select count(*) from public.assistance_requests where status = 'submitted' and (service_code is not null or care_plan_id is not null)),
    'care_to_quote', (select count(*) from public.assistance_requests where status = 'submitted' and care_plan_id is not null),
    'order_payments_to_check', (select count(*) from public.assistance_requests where payment_status = 'pending_verification'),
    'care_payments_to_check', (select count(*) from public.care_invoices where status = 'pending_verification'),
    'care_overdue', (select count(*) from public.care_invoices where status = 'due' and due_on < v_today),
    'claims_to_decide', (select count(*) from public.guarantee_claims where status = 'submitted'),
    'claims_to_pay', (select count(*) from public.guarantee_claims where status = 'approved'),
    'partners_to_bill', (select count(distinct partner_id) from public.partner_charges where status = 'unbilled' and occurred_on < date_trunc('month', v_today)::date),
    'statements_overdue', (select count(*) from public.partner_statements where status = 'sent' and due_on < v_today),
    'applications_new', (select count(*) from public.partner_applications where status = 'new'),
    'disputes_open', (select count(*) from public.lead_disputes where status = 'open'),
    'firms_paused', (select count(*) from public.partners p where p.published and not private.partner_live(p)),
    'credit_held', coalesce((select sum(credit_php) from public.partners), 0),
    'staff_access_open', (select count(*) from private.staff_memberships where ended_at is null),
    'covered_missing_dates', (select count(distinct c.requirement_id) from public.care_plans p cross join lateral private.care_covered(p.id) c
                              join public.requirement_status rs on rs.id = c.requirement_id
                              where p.status = 'active' and rs.expires and rs.expires_on is null),
    'missing_invoice', (select count(*) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and coalesce(quote_php, 0) > 0 and bir_invoice_no is null)
                     + (select count(*) from public.care_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.partner_statements where status = 'paid' and bir_invoice_no is null)
                     + (select count(*) from public.payments where status = 'paid' and plan_id is not null and bir_invoice_no is null)
                     + (select count(*) from public.partner_credits where kind = 'topup' and bir_invoice_no is null)
  ) into v;
  return v;
end $$;

create or replace function public.admin_set_invoice_no(p_kind text, p_id uuid, p_no text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_no text := nullif(btrim(coalesce(p_no, '')), '');
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(coalesce(v_no, '')) > 60 then raise exception 'That invoice number is too long.' using errcode = '22023'; end if;
  if p_kind = 'order' then update public.assistance_requests set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'care' then update public.care_invoices set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'statement' then update public.partner_statements set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'plan' then update public.payments set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'credit' then update public.partner_credits set bir_invoice_no = v_no where id = p_id and kind = 'topup';
  else raise exception 'Unknown payment.' using errcode = '22023'; end if;
  if not found then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
end $$;

create or replace function private.revenue_daily() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  v_n := v_n + private.care_daily();
  v_n := v_n + private.partner_monthly_charges();
  v_n := v_n + private.referral_followups();
  delete from private.placement_seen where day < private.today_ph() - 60;
  return v_n;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.admin_add_credit(uuid,numeric,text,text,text)', 'public.admin_adjust_credit(uuid,numeric,text)',
    'public.admin_decide_dispute(uuid,boolean,text)', 'public.answer_referral(uuid,boolean)', 'public.list_professionals()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.lead_for_firm(uuid)', 'public.report_lead(uuid,text,text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

insert into private.features (name) values ('leads') on conflict do nothing;
