-- Fix: asking a professional for a quote failed with a database error when that professional had no
-- "fee per quote request" set (the admin form allows leaving it blank). The commission row now records 0.
create or replace function public.request_referral(p_org uuid, p_partner uuid, p_requirement uuid default null, p_note text default null,
  p_contact_method text default 'email', p_contact_value text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_partner public.partners; v_org text; v_who text; v_req text; v_body text;
begin
  if p_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_partner from public.partners where id = p_partner and published;
  if v_partner.id is null then raise exception 'That professional is not available.' using errcode = '23503'; end if;
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
  insert into public.referrals (org_id, partner_id, requirement_id, note, contact_method, contact_value)
  values (p_org, p_partner, p_requirement, nullif(btrim(p_note), ''), coalesce(p_contact_method, 'email'), nullif(btrim(p_contact_value), ''))
  returning id into v_id;
  insert into public.referral_commissions (referral_id, amount_php) values (v_id, coalesce(v_partner.lead_fee_php, 0));
  select name into v_org from public.orgs where id = p_org;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) into v_who from public.profiles where id = auth.uid();
  v_body := 'New quote request from PermitPal.' || E'\n\n' || 'Business: ' || v_org || E'\n' || 'Name: ' || coalesce(v_who, '-') || E'\n' ||
    'Contact via ' || coalesce(p_contact_method, 'email') || ': ' || coalesce(p_contact_value, '-') || E'\n' ||
    coalesce('Permit: ' || v_req || E'\n', '') || coalesce('Message: ' || nullif(btrim(p_note), '') || E'\n', '') ||
    E'\nPlease contact them directly within 1 business day.';
  if v_partner.contact_email is not null then
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    values (null, 'email', v_partner.contact_email, 'New quote request: ' || v_org,
      v_body, private.email_html('New quote request from PermitPal', '<p style="white-space:pre-line">' || private.html_escape(v_body) || '</p>', null, null),
      'lead:' || v_id);
  end if;
  perform private.notify_admins('Lead sent to ' || v_partner.name, v_org || ' - ' || coalesce(v_req, 'general request'), 'ref:' || v_id, false);
  return v_id;
end $$;
