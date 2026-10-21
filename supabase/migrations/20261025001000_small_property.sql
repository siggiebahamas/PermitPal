-- ======================================================================== Small property, firms' own confirmation, "license"
-- 1) Small property: ₱2,990 a month (₱29,900 a year) for up to 20 tenants, everything else the same as
--    Mall & property (₱9,990, any number of tenants).
-- 2) Firms that want to be listed confirm they are registered and hold the licenses their work needs.
--    PermitPal lists them as independent businesses and doesn't check or vouch for them.
-- 3) "license" spelled the American way in every message, bill name and template.

-- ---------------------------------------------------------------- 1) Small property
insert into public.plans (id, name, price_php_monthly, max_members, max_locations_per_business, paid_channels, features, sort, available)
values ('property_s', 'Small property', 2990, null, null, true,
  array['Tenant board for up to 20 tenants', 'Choose which permits tenants must keep current', 'Download tenants'' shared copies', 'One-click reminders to tenants', 'Everything in Free'], 13, true)
on conflict (id) do update set name = excluded.name, price_php_monthly = excluded.price_php_monthly, paid_channels = true, available = true;
update public.plans set sort = 14 where id = 'property';
-- Head office left the app on Oct 7 (PermitPal is for small businesses); make sure nobody can buy it.
update public.plans set available = false where id = 'head_office';
-- How many tenants a workspace may connect (null: no limit), and how many it has (connected or invited).
create or replace function private.tenant_cap(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$ select case when private.effective_plan_id(p_org) = 'property_s' then 20 end $$;
create or replace function private.tenant_count(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.org_links where owner_org = p_org and status in ('pending','active')
$$;
revoke all on function private.tenant_cap(uuid) from public, anon, authenticated;
revoke all on function private.tenant_count(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2) firms confirm for themselves
alter table public.partner_applications add column if not exists attested boolean not null default false;
drop function if exists public.apply_as_partner(text,text,text,text,text,text,text,text,text,text,text);

create or replace function public.apply_as_partner(p_name text, p_category text, p_cities text, p_contact_name text, p_email text, p_phone text,
  p_licence text, p_services text, p_website text, p_message text, p_trap text default null, p_attested boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(p_trap, '') <> '' then return; end if;  -- filled in by bots, never by people (the box is hidden)
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your firm''s name.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_contact_name, ''))) < 2 then raise exception 'Enter your name.' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if coalesce(p_category, '') not in ('liaison','bookkeeping','fire_safety','pest_control','health_clinic','emission_testing','vehicle_inspection','insurance','notary','other') then
    raise exception 'Choose what your firm does.' using errcode = '22023';
  end if;
  if not coalesce(p_attested, false) then
    raise exception 'Please confirm your business is registered and holds the licenses its work needs.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_website), '') <> '' and btrim(p_website) !~ '^https://' then raise exception 'The website must start with https://' using errcode = '22023'; end if;
  if exists (select 1 from public.partner_applications where lower(email) = v_email and created_at > now() - interval '1 day') then
    raise exception 'We already have your application. We''ll reply within 3 business days.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.partner_applications where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'We''re getting a lot of applications right now. Please try again in an hour.' using errcode = 'P0001';
  end if;
  insert into public.partner_applications (name, category, cities, contact_name, email, phone, licence, services, website, message, attested)
  values (btrim(p_name), p_category, left(btrim(coalesce(p_cities, '')), 300), btrim(p_contact_name), v_email, left(btrim(coalesce(p_phone, '')), 60),
    left(btrim(coalesce(p_licence, '')), 200), left(btrim(coalesce(p_services, '')), 600), left(btrim(coalesce(p_website, '')), 300), left(btrim(coalesce(p_message, '')), 1500), true);
  perform private.notify_admins('Firm wants to be listed: ' || btrim(p_name),
    btrim(p_contact_name) || ' (' || v_email || coalesce(', ' || nullif(btrim(p_phone), ''), '') || ') - ' || p_category ||
    coalesce(' - ' || nullif(btrim(p_cities), ''), '') || '. They confirmed they are registered and licensed.', 'apply:' || v_email || ':' || private.today_ph(), true);
end $$;
revoke all on function public.apply_as_partner(text,text,text,text,text,text,text,text,text,text,text,boolean) from public;
grant execute on function public.apply_as_partner(text,text,text,text,text,text,text,text,text,text,text,boolean) to anon, authenticated;

-- ---------------------------------------------------------------- 3) "license" in stored words
update public.doc_templates set body = regexp_replace(body, '\m([Ll])icence', '\1icense', 'g'),
  title = regexp_replace(title, '\m([Ll])icence', '\1icense', 'g'), summary = regexp_replace(summary, '\m([Ll])icence', '\1icense', 'g'),
  use_when = regexp_replace(use_when, '\m([Ll])icence', '\1icense', 'g'), fields = regexp_replace(fields::text, '\m([Ll])icence', '\1icense', 'g')::jsonb
where (body || title || summary || coalesce(use_when, '') || fields::text) ~* 'licence';
update public.requirement_types set
  name = regexp_replace(name, '\m([Ll])icence', '\1icense', 'g'), agency = regexp_replace(agency, '\m([Ll])icence', '\1icense', 'g'),
  help_text = regexp_replace(help_text, '\m([Ll])icence', '\1icense', 'g'), where_to_file = regexp_replace(where_to_file, '\m([Ll])icence', '\1icense', 'g'),
  online_label = regexp_replace(online_label, '\m([Ll])icence', '\1icense', 'g'), validity_note = regexp_replace(validity_note, '\m([Ll])icence', '\1icense', 'g'),
  checklist = regexp_replace(checklist::text, '"(t|d)": "([^"]*)\m([Ll])icence', '"\1": "\2\3icense', 'g')::jsonb
where concat_ws(' ', name, agency, help_text, where_to_file, online_label, validity_note, checklist::text) ~* 'licence';

-- ---------------------------------------------------------------- 4) changes to earlier functions

-- Team tools: the Small property plan counts as a team plan.
CREATE OR REPLACE FUNCTION private.has_team_tools(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(private.is_platform_admin(), false) or exists (
    select 1 from public.orgs o where o.id = p_org and o.deleted_at is null and o.kind <> 'business' and (
      (o.trial_ends_at is not null and o.trial_ends_at > now())
      or private.effective_plan_id(o.id) in ('fleet','firm','head_office','property','property_s')))
$function$;

-- Plus comes with the Small property plan too.
CREATE OR REPLACE FUNCTION private.has_plus(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.orgs o where o.id = p_org and o.deleted_at is null and (
      exists (select 1 from public.addons a where a.org_id = o.id and a.kind = 'plus' and a.paid_through >= private.today_ph())
      or (o.kind <> 'business' and ((o.trial_ends_at is not null and o.trial_ends_at > now())
                                    or private.effective_plan_id(o.id) in ('fleet','firm','head_office','property','property_s')))))
$function$;

-- Bills: Plus is included in the Small property plan.
CREATE OR REPLACE FUNCTION private.addon_check_args(p_org uuid, p_kind text, p_people integer, p_billing text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_now int;
begin
  if p_kind not in ('plus','staff','brand') then raise exception 'Choose Plus, staff licenses or White-label.' using errcode = '22023'; end if;
  if coalesce(p_billing, '') not in ('monthly','yearly') then raise exception 'Choose monthly or yearly.' using errcode = '22023'; end if;
  if p_kind = 'brand' then
    if p_people is not null then raise exception 'White-label has no number of people.' using errcode = '22023'; end if;
    if not private.brand_eligible(p_org) then
      raise exception 'White-label is for Accounting firm workspaces with the firm plan (or its free trial).' using errcode = 'P0001';
    end if;
  elsif p_kind = 'plus' then
    if p_people is not null then raise exception 'Plus has no number of people.' using errcode = '22023'; end if;
    if exists (select 1 from public.orgs o where o.id = p_org and o.kind <> 'business' and private.effective_plan_id(o.id) in ('fleet','firm','head_office','property','property_s')) then
      raise exception 'Plus is already included in your team plan.' using errcode = 'P0001';
    end if;
  else
    if p_people is null or p_people < private.free_people() + 1 or p_people > 5000 then
      raise exception 'Choose from % to 5,000 people. The first % are free.', private.free_people() + 1, private.free_people() using errcode = '22023';
    end if;
    v_now := private.active_people(p_org);
    if p_people < v_now then
      raise exception 'You''re tracking % people. Remove people first, or choose at least %.', v_now, v_now using errcode = 'P0001';
    end if;
  end if;
end $function$;

-- The morning job: no Plus bill inside the Small property plan.
CREATE OR REPLACE FUNCTION private.plus_daily()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := private.today_ph(); v_n int := 0; a record; v_inv public.addon_invoices; v_people int; v_paused int; o record;
begin
  -- unpaid bills past their date
  update public.addon_invoices set status = 'cancelled', note = 'Not paid in time. Choose your plan again for a new bill.'
  where status = 'due' and valid_until < v_today;
  -- plans set to stop: forget the stop once the period is over
  delete from private.addon_stops where stop_after < v_today;

  -- the next period's bill, 7 days ahead (not for trials, gifts, plans set to stop, or Plus inside a team plan)
  for a in
    select ad.*, private.addon_label(ad.kind, coalesce(ad.next_people_max, ad.people_max), coalesce(ad.next_billing, ad.billing)) as label
    from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
    where not ad.trial and not ad.comped and ad.paid_through between v_today and v_today + 7
      and not exists (select 1 from private.addon_stops s where s.org_id = ad.org_id and s.kind = ad.kind)
      and not exists (select 1 from public.addon_invoices i where i.org_id = ad.org_id and i.kind = ad.kind
                      and i.status in ('due','pending_verification') and i.period_start > ad.paid_through)
      and not (ad.kind = 'plus' and og.kind <> 'business' and private.effective_plan_id(og.id) in ('fleet','firm','head_office','property','property_s'))
      and not (ad.kind = 'brand' and not private.brand_eligible(og.id))
  loop
    insert into public.addon_invoices (number, org_id, kind, people_max, billing, months, price_php, credit_php, amount_php, period_start, period_end, renewal, valid_until, created_by)
    values (private.next_no('PPA'), a.org_id, a.kind, case when a.kind = 'staff' then coalesce(a.next_people_max, a.people_max) end,
      coalesce(a.next_billing, a.billing), case coalesce(a.next_billing, a.billing) when 'yearly' then 12 else 1 end,
      private.addon_price(a.kind, coalesce(a.next_people_max, a.people_max), coalesce(a.next_billing, a.billing)), 0,
      private.addon_price(a.kind, coalesce(a.next_people_max, a.people_max), coalesce(a.next_billing, a.billing)),
      a.paid_through + 1, (a.paid_through + 1 + make_interval(months => case coalesce(a.next_billing, a.billing) when 'yearly' then 12 else 1 end))::date - 1,
      true, a.paid_through + 14, null)
    returning * into v_inv;
    perform private.notify_owners(a.org_id, a.label || ' renews on ' || private.fmt_date(a.paid_through + 1) || ': ' || private.peso(v_inv.amount_php),
      'Bill ' || v_inv.number || '. Pay by ' || private.fmt_date(a.paid_through) || ' to keep it on without a break: GCash, Maya, bank or card, under Settings > Plan.',
      '#/settings/billing', 'addonrenew:' || v_inv.id, true, true);
    v_n := v_n + 1;
  end loop;

  -- the last day of an unpaid period
  for a in select i.*, private.addon_label(i.kind, i.people_max, i.billing) as label from public.addon_invoices i
      where i.status = 'due' and i.renewal and i.period_start = v_today + 1 loop
    perform private.notify_owners(a.org_id, 'Last day: ' || a.label || ' ends today',
      'Pay bill ' || a.number || ' (' || private.peso(a.amount_php) || ') today to keep it on. Your records are safe either way.',
      '#/settings/billing', 'addonlast:' || a.id, true, true);
  end loop;

  -- free trial ending soon / ended
  for a in select ad.* from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
      where ad.kind in ('plus','brand') and ad.trial and ad.paid_through in (v_today + 2, v_today - 1) loop
    perform private.notify_owners(a.org_id,
      case when a.paid_through >= v_today then 'Your ' || case a.kind when 'brand' then 'White-label' else 'Plus' end || ' trial ends on ' || private.fmt_date(a.paid_through)
           else 'Your ' || case a.kind when 'brand' then 'White-label' else 'Plus' end || ' trial has ended' end,
      case when a.kind = 'brand' and a.paid_through >= v_today then 'Keep your name, logo and color on your clients'' reminders, and the monthly client report, for ₱1,000 a month (or ₱10,000 a year).'
           when a.kind = 'brand' then 'Your clients'' emails and app show PermitPal''s own look again. Your brand settings are saved. Turn White-label on again anytime.'
           when a.paid_through >= v_today then 'Keep your public permit page, monthly permit check and templates for ₱199 a month (or ₱1,990 a year).'
           else 'Your public permit page now shows "paused" and the monthly check has stopped. Your records are safe. Turn Plus on again anytime.' end,
      '#/settings/billing', case a.kind when 'brand' then 'brandtrial:' else 'plustrial:' end || a.org_id || ':' || a.paid_through || ':' || case when a.paid_through >= v_today then 'soon' else 'ended' end, true, true);
  end loop;

  -- paid or given plans that ended yesterday
  for a in select ad.* from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
      where not ad.trial and ad.paid_through = v_today - 1 loop
    v_people := private.active_people(a.org_id);
    perform private.notify_owners(a.org_id,
      case a.kind when 'plus' then 'PermitPal Plus has ended' when 'brand' then 'White-label has ended' else 'Your staff licenses have ended' end,
      case when a.kind = 'brand' then 'Your clients'' emails and app show PermitPal''s own look again. Your brand settings are saved. Turn it on again under Settings > Plan.'
           when a.kind = 'plus' then 'Your public permit page now shows "paused" and the monthly check has stopped. Your records are safe. Turn it on again under Settings > Plan.'
           else 'Reminders for ' || greatest(v_people - private.free_people(), 0) || ' of your ' || v_people || ' people are paused (the first ' || private.free_people() ||
                ' stay free). Nothing was deleted. Add licenses under Settings > Plan to turn them back on.' end,
      '#/settings/billing', 'addonend:' || a.org_id || ':' || a.kind || ':' || a.paid_through, true, true);
  end loop;

  -- people above what's paid for pause; paid-for people wake up
  for o in select p.org_id from public.people p where p.deleted_at is null or p.paused_at is not null
      group by p.org_id having count(*) filter (where p.deleted_at is null) > private.free_people() or bool_or(p.paused_at is not null) loop
    v_paused := private.sync_people(o.org_id);
  end loop;

  -- the permit check, every morning for Plus; the report on the 1st
  for o in select og.id from public.orgs og where og.deleted_at is null and private.has_plus(og.id) loop
    perform private.run_audit(o.id, 'daily');
    if extract(day from v_today) = 1 then v_n := v_n + private.audit_report(o.id, false); end if;
  end loop;

  v_n := v_n + private.worker_reminders();
  v_n := v_n + private.trust_updates();

  -- keep a little over a year of history
  delete from public.trust_page_views where viewed_at < now() - interval '400 days';
  delete from public.audit_runs r where r.ran_at < now() - interval '400 days';
  delete from public.audit_findings where status in ('fixed','dismissed') and closed_at < now() - interval '400 days';
  delete from private.template_uses where used_at < now() - interval '400 days';
  return v_n;
end $function$;

-- Inviting: the Small property plan stops at 20 tenants.
CREATE OR REPLACE FUNCTION public.link_invite(p_owner uuid, p_relation text, p_email text, p_label text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_brand jsonb; v_org public.orgs; v_id uuid; v_token text; v_email text := lower(btrim(p_email)); v_url text; v_who text;
begin
  if not private.is_org_admin(p_owner) then raise exception 'Only the workspace owner or an admin can invite.' using errcode = '42501'; end if;
  if not private.has_team_tools(p_owner) then raise exception 'Your trial has ended. Choose a plan in Settings → Plan to keep connecting.' using errcode = 'P0001', hint = 'plan_limit'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address.' using errcode = '22023'; end if;
  select * into v_org from public.orgs where id = p_owner;
  v_brand := private.brand_json(p_owner);
  v_org.name := coalesce(v_brand ->> 'name', v_org.name);
  select id, token into v_id, v_token from public.org_links where owner_org = p_owner and invited_email = v_email and status = 'pending';
  if v_id is null and private.tenant_cap(p_owner) is not null and private.tenant_count(p_owner) >= private.tenant_cap(p_owner) then
    raise exception 'Your Small property plan covers % tenants. Move to Mall & property (Settings > Plan) to add more.', private.tenant_cap(p_owner)
      using errcode = 'P0001', hint = 'tenant_limit';
  end if;
  if v_id is null then
    insert into public.org_links (owner_org, relation, label, invited_email, created_by)
    values (p_owner, p_relation, left(coalesce(btrim(p_label), ''), 120), v_email, auth.uid()) returning id, token into v_id, v_token;
  end if;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) into v_who from public.profiles where id = auth.uid();
  v_url := coalesce(private.setting('app_url'), '') || '#/connect/' || v_token;
  insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key, from_name, reply_to)
  values (p_owner, 'email', v_email, v_org.name || ' invites you to connect on PermitPal',
    v_who || ' of ' || v_org.name || ' would like to see the status of your permits (names, status and expiry dates only) as their '
      || private.relation_label(p_relation) || '. PermitPal is free for your business. Open this link to accept or decline: ' || v_url,
    private.email_html_b(v_brand || jsonb_build_object('why', 'You got this because ' || v_org.name || ' invited ' || v_email || '.'), v_org.name || ' invites you to connect',
      '<p>' || private.html_escape(coalesce(v_who, 'Someone')) || ' of <b>' || private.html_escape(v_org.name) || '</b> would like to see the status of your permits as their '
      || private.relation_label(p_relation) || '.</p><p>They will see permit names, status and expiry dates only. You decide whether they may download copies, and you can disconnect anytime. PermitPal is free for your business.</p>',
      'Review the invitation', v_url),
    'linkinv:' || v_id || ':' || to_char(now(), 'YYYYMMDDHH24'), v_brand ->> 'name', v_brand ->> 'reply_to')
  on conflict (dedupe_key) do nothing;
  return v_id;
end $function$;

-- Paying online: Small property only up to 20 tenants.
CREATE OR REPLACE FUNCTION public.billing_start(p_org uuid, p_plan text, p_months integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.plans;
  v_id uuid;
  v_amount numeric;
begin
  if p_plan like 'addon:%' then return private.addon_payment_start(p_org, p_plan); end if;
  if private.member_role(p_org) is distinct from 'owner' then
    raise exception 'Only the workspace owner can change the plan.' using errcode = '42501';
  end if;
  select * into v_plan from public.plans where id = p_plan;
  if v_plan.id is null or coalesce(v_plan.price_php_monthly, 0) <= 0 then
    raise exception 'That plan is not available for online payment yet.' using errcode = 'P0001';
  end if;
  if p_plan = 'property_s' and private.tenant_count(p_org) > 20 then
    raise exception 'You have % tenants. Small property covers up to 20: choose Mall & property.', private.tenant_count(p_org) using errcode = 'P0001', hint = 'tenant_limit';
  end if;
  if p_months not between 1 and 12 then raise exception 'Choose between 1 and 12 months.' using errcode = '22023'; end if;
  -- A year (12 months) costs 10 months: 2 months free.
  v_amount := v_plan.price_php_monthly * case when p_months = 12 then 10 else p_months end;
  insert into public.payments (org_id, plan_id, months, amount_php, created_by)
  values (p_org, p_plan, p_months, v_amount, auth.uid()) returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount_php', v_amount,
    'plan_name', v_plan.name, 'months', p_months, 'months_free', case when p_months = 12 then 2 else 0 end,
    'org_name', (select name from public.orgs where id = p_org),
    'email', (select email from public.profiles where id = auth.uid()));
end $function$;

-- Paying by transfer: the same check.
CREATE OR REPLACE FUNCTION public.request_plan(p_org uuid, p_plan text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org public.orgs; v_plan public.plans; v_who text;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can change the plan.' using errcode = '42501'; end if;
  select * into v_org from public.orgs where id = p_org;
  select * into v_plan from public.plans where id = p_plan and available;
  if v_plan.id is null then raise exception 'That plan is not available.' using errcode = 'P0001'; end if;
  if p_plan = 'property_s' and private.tenant_count(p_org) > 20 then
    raise exception 'You have % tenants. Small property covers up to 20: choose Mall & property.', private.tenant_count(p_org) using errcode = 'P0001', hint = 'tenant_limit';
  end if;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) || ' (' || email || ')' into v_who from public.profiles where id = auth.uid();
  perform private.notify_admins('Plan request: ' || v_plan.name || ' for ' || v_org.name,
    coalesce(v_who, '-') || ' wants the ' || v_plan.name || ' plan (₱' || v_plan.price_php_monthly || '/month).' || coalesce(' Note: ' || nullif(btrim(p_note), ''), ''),
    'planreq:' || p_org || ':' || p_plan || ':' || to_char(now(), 'YYYYMMDD'), true);
end $function$;

-- A listing made from an application keeps the firm's own confirmation.
CREATE OR REPLACE FUNCTION public.admin_application_to_partner(p_app uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_a public.partner_applications; v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_a from public.partner_applications where id = p_app;
  if v_a.id is null or v_a.status <> 'new' then raise exception 'This application was already handled.' using errcode = 'P0001'; end if;
  insert into public.partners (category, name, description, licence, services, website, contact_name, contact_phone, contact_email, cities, published, verified,
    fee_model, commission_terms)
  values (v_a.category, v_a.name, '', v_a.licence, v_a.services, v_a.website, v_a.contact_name, v_a.phone, v_a.email,
    coalesce((select array_agg(btrim(c)) from unnest(string_to_array(v_a.cities, ',')) c where btrim(c) <> ''), '{}'), false, coalesce(v_a.attested, false),
    case when v_a.category = 'insurance' then 'none' else 'per_lead' end, 'From application ' || to_char(v_a.created_at, 'YYYY-MM-DD'))
  returning id into v_id;
  update public.partner_applications set status = 'listed', partner_id = v_id, decided_at = now() where id = p_app;
  return v_id;
end $function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION public.request_services_bulk(p_org uuid, p_reqs uuid[], p_rush boolean DEFAULT false, p_contact_method text DEFAULT 'email'::text, p_contact_value text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_consent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch uuid := gen_random_uuid();
  v_n int := coalesce(cardinality(p_reqs), 0);
  v_r record; v_svc text; v_found int := 0; v_names text[] := '{}'; v_org text; v_who text;
begin
  if p_org is null or p_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not coalesce(p_consent, false) then
    raise exception 'Please tick the box to confirm PermitPal may act for you on these permits.' using errcode = '22023';
  end if;
  if v_n = 0 then raise exception 'Choose at least one permit.' using errcode = '22023'; end if;
  if v_n > 25 then raise exception 'Choose up to 25 permits at a time.' using errcode = '22023'; end if;
  if (select count(distinct x) from unnest(p_reqs) x) <> v_n then raise exception 'A permit was chosen twice.' using errcode = '22023'; end if;
  if coalesce(p_contact_method, 'email') not in ('email','phone','whatsapp','viber') then raise exception 'Choose how we should reach you.' using errcode = '22023'; end if;
  if (select count(*) from public.assistance_requests where org_id = p_org and status not in ('completed','cancelled') and care_plan_id is null) + v_n > 25 then
    raise exception 'That would make more than 25 open requests. Choose fewer, or wait for some to finish.' using errcode = 'P0001';
  end if;
  if (select count(distinct coalesce(batch_id, id)) from public.assistance_requests
      where org_id = p_org and created_at > now() - interval '1 hour' and (care_plan_id is null or created_by is not null)) >= 10 then
    raise exception 'That''s a lot of requests in one hour. Please try again a little later, or message us.' using errcode = 'P0001';
  end if;
  perform set_config('pp.order_rpc', 'on', true);
  perform set_config('pp.bulk', 'on', true);
  for v_r in select rs.id, rs.name, rs.subject, rs.type_code, rs.open_request_id, rs.cycle_id, rs.subject_name
             from public.requirement_status rs where rs.id = any(p_reqs) and rs.org_id = p_org order by rs.name loop
    if v_r.subject = 'person' then raise exception '% is a staff license. Ask for it on its own page.', v_r.name using errcode = 'P0001'; end if;
    if v_r.open_request_id is not null then raise exception '% (%) already has an open request.', v_r.name, v_r.subject_name using errcode = 'P0001'; end if;
    v_svc := private.renewal_service_for(v_r.type_code);
    if v_svc is null then raise exception 'We can''t take % right now. Message us instead.', v_r.name using errcode = 'P0001'; end if;
    insert into public.assistance_requests (org_id, service_code, requirement_id, requirement_name, subject_label, notes, rush,
      contact_method, contact_value, docs_status, kind, consented_at, batch_id)
    values (p_org, v_svc, v_r.id, '-', '-', nullif(btrim(p_notes), ''), coalesce(p_rush, false), coalesce(p_contact_method, 'email'),
      nullif(btrim(p_contact_value), ''), 'not_sure', case when v_r.cycle_id is null then 'apply' else 'renew' end, now(), v_batch);
    v_found := v_found + 1;
    v_names := v_names || (v_r.name || ' (' || coalesce(v_r.subject_name, '') || ')');
  end loop;
  perform set_config('pp.bulk', 'off', true);
  perform set_config('pp.order_rpc', 'off', true);
  if v_found <> v_n then raise exception 'One of those permits was not found. Refresh the page and try again.' using errcode = 'P0002'; end if;
  select name into v_org from public.orgs where id = p_org;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) || ' (' || email || ')' into v_who from public.profiles where id = auth.uid();
  perform private.notify_admins('New request: ' || v_n || ' permits' || case when p_rush then ' - RUSH' else '' end,
    v_org || ' - ' || array_to_string(v_names, '; ') || '. Requested by ' || coalesce(v_who, '-') || ', contact via ' ||
    coalesce(p_contact_method, 'email') || coalesce(': ' || nullif(btrim(p_contact_value), ''), '') || '. Notes: ' || coalesce(nullif(btrim(p_notes), ''), '-'),
    'orderbatch:' || v_batch, true);
  perform private.notify(auth.uid(), p_org, 'help', 'We received your request for ' || v_n || ' permits',
    'You''ll get an exact quote for each one within 1 business day. Nothing starts until you accept.', '#/services', null, 'orderbatchack:' || v_batch, true);
  return v_batch;
end $function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION private.partner_fee_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.category = 'insurance' and coalesce(btrim(private.setting('ic_licence_no')), '') = ''
     and ((new.fee_model = 'per_lead' and coalesce(new.lead_fee_php, 0) > 0)
       or (new.fee_model = 'per_sale_flat' and coalesce(new.sale_fee_php, 0) > 0)
       or (new.fee_model = 'per_sale_percent' and coalesce(new.sale_pct, 0) > 0)) then
    raise exception 'Insurance rule: only a licensed insurance agent or broker may be paid per quote request or per sale (Insurance Code, Sec. 307). Choose "Flat monthly listing" or "No fee", or add your Insurance Commission license number in Admin > Money first.'
      using errcode = '22023';
  end if;
  return new;
end $function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION public.admin_set_money_setting(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text := btrim(coalesce(p_value, ''));
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_key = 'money_goal' then
    if v !~ '^\d{0,9}(\.\d{1,2})?$' then raise exception 'Enter the goal in pesos, e.g. 100000.' using errcode = '22023'; end if;
  elsif p_key = 'ic_licence_no' then
    if length(v) > 60 then raise exception 'That license number is too long.' using errcode = '22023'; end if;
  else raise exception 'Unknown setting.' using errcode = '22023'; end if;
  insert into private.settings (key, value) values (p_key, v) on conflict (key) do update set value = excluded.value;
end $function$;

-- Spelling: license (bill names).
CREATE OR REPLACE FUNCTION private.addon_label(p_kind text, p_people integer, p_billing text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_kind when 'plus' then 'PermitPal Plus' when 'brand' then 'White-label' else 'Staff licenses, up to ' || p_people || ' people' end
    || case p_billing when 'yearly' then ' (yearly)' else ' (monthly)' end
$function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION private.people_seat_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_cap int; v_n int;
begin
  if tg_op = 'UPDATE' then
    -- only the nightly/plan sync changes "paused"
    if new.paused_at is distinct from old.paused_at and coalesce(current_setting('pp.people_sync', true), 'off') <> 'on' then
      new.paused_at := old.paused_at;
    end if;
    if not (old.deleted_at is not null and new.deleted_at is null) then return new; end if;
  elsif new.deleted_at is not null then return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-people:' || new.org_id::text, 0));
  v_cap := private.people_cap(new.org_id);
  select count(*) into v_n from public.people where org_id = new.org_id and deleted_at is null and id <> new.id;
  if v_n >= v_cap then
    raise exception '%', case when v_cap <= private.free_people()
        then 'You''re tracking ' || v_n || ' people: the free limit is ' || private.free_people() || '. Add staff licenses (from ₱100 a month per person) under Settings > Plan to track more.'
        else 'You''re tracking ' || v_n || ' people, the most your staff licenses cover. Add more under Settings > Plan.' end
      using errcode = 'P0001', hint = 'seat_limit';
  end if;
  new.paused_at := null;
  return new;
end $function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION public.admin_set_addon(p_org uuid, p_kind text, p_people integer, p_until date, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_kind not in ('plus','staff','brand') then raise exception 'Choose Plus, staff licenses or White-label.' using errcode = '22023'; end if;
  if p_kind = 'staff' and (p_people is null or p_people < 4 or p_people > 5000) then raise exception 'Choose from 4 to 5,000 people.' using errcode = '22023'; end if;
  if p_kind = 'brand' and not exists (select 1 from public.orgs where id = p_org and kind = 'firm') then
    raise exception 'White-label is for Accounting firm workspaces.' using errcode = 'P0001';
  end if;
  if p_until is null or p_until > private.today_ph() + 800 then raise exception 'Choose an end date within about 2 years.' using errcode = '22023'; end if;
  insert into public.addons (org_id, kind, people_max, billing, paid_through, comped, started_on)
  values (p_org, p_kind, case when p_kind = 'staff' then p_people end, 'monthly', p_until, true, private.today_ph())
  on conflict (org_id, kind) do update set people_max = case when p_kind = 'staff' then p_people end, paid_through = p_until,
    comped = true, trial = false, updated_at = now();
  if p_kind = 'staff' then perform private.sync_people(p_org); end if;
  perform private.notify_owners(p_org, private.addon_label(p_kind, case when p_kind = 'staff' then p_people end, 'monthly') || ' added by PermitPal',
    'On until ' || private.fmt_date(p_until) || '.' || coalesce(' ' || nullif(btrim(p_note), ''), ''), '#/settings/billing',
    'addoncomp:' || p_org || ':' || p_kind || ':' || p_until, true, true);
end $function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION public.worker_link(p_requirement uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.requirements; v_tok uuid;
begin
  select * into r from public.requirements where id = p_requirement and deleted_at is null;
  if r.id is null or r.org_id not in (select private.my_writable_org_ids()) then raise exception 'License not found.' using errcode = '42501'; end if;
  if r.subject <> 'person' then raise exception 'Upload links are for staff licenses.' using errcode = '22023'; end if;
  if exists (select 1 from public.people where id = r.person_id and paused_at is not null) then
    raise exception 'This person is paused because your staff licenses don''t cover them. Add licenses under Settings > Plan.' using errcode = 'P0001';
  end if;
  v_tok := private.worker_link_for(r.id);
  return v_tok;
end $function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION public.worker_submit(p_token uuid, p_path text, p_file_name text, p_mime text, p_size bigint, p_expires date, p_issued date DEFAULT NULL::date, p_ref text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.worker_links; r public.requirements; v_id uuid; v_today date := private.today_ph(); v_name text; v_who record;
begin
  select * into l from public.worker_links where token = p_token for update;
  if l.token is null or l.used_at is not null or l.expires_at < now() then
    raise exception 'This link has already been used or has expired. Ask your employer for a new one.' using errcode = 'P0001';
  end if;
  select * into r from public.requirements where id = l.requirement_id and deleted_at is null;
  if r.id is null or exists (select 1 from public.people where id = l.person_id and (deleted_at is not null or paused_at is not null)) then
    raise exception 'This link is no longer active. Ask your employer for a new one.' using errcode = 'P0001';
  end if;
  if p_path is null or p_path not like l.org_id::text || '/worker/' || l.token::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = p_path) then
    raise exception 'Add a photo of the new license first.' using errcode = '22023';
  end if;
  if r.expires and p_expires is null then raise exception 'Enter the new expiry date (it''s printed on the license).' using errcode = '22023'; end if;
  if p_expires is not null and (p_expires < v_today - 365 or p_expires > v_today + 3700) then
    raise exception 'Check the expiry date: it doesn''t look right.' using errcode = '22023';
  end if;
  if p_issued is not null and (p_issued > v_today + 1 or (p_expires is not null and p_issued > p_expires)) then
    raise exception 'Check the date it was issued: it can''t be after today or after the expiry date.' using errcode = '22023';
  end if;
  insert into public.worker_submissions (org_id, person_id, requirement_id, token, storage_path, file_name, mime_type, size_bytes, reference_no, issued_on, expires_on, note)
  values (l.org_id, l.person_id, r.id, l.token, p_path, left(coalesce(nullif(btrim(p_file_name), ''), 'photo.jpg'), 255), left(p_mime, 100),
    case when p_size between 1 and 10485760 then p_size end, nullif(left(btrim(p_ref), 100), ''), p_issued, p_expires, nullif(left(btrim(p_note), 300), ''))
  returning id into v_id;
  update public.worker_links set used_at = now() where token = l.token;
  select full_name into v_name from public.people where id = l.person_id;
  -- tell the people who look after this license (its assignee, else owners and admins)
  for v_who in select m.user_id from public.org_members m where m.org_id = l.org_id
      and (m.user_id = r.assignee_id or (r.assignee_id is null and m.role in ('owner','admin'))) loop
    perform private.notify(v_who.user_id, l.org_id, 'team', v_name || ' sent a renewed ' || r.name,
      'Check the photo and dates, then approve it to update their record.', '#/people/' || l.person_id, r.id, 'wsub:' || v_id || ':' || v_who.user_id, true);
  end loop;
  return jsonb_build_object('ok', true);
end $function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION public.worker_decide(p_submission uuid, p_approve boolean, p_expires date DEFAULT NULL::date, p_issued date DEFAULT NULL::date, p_ref text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.worker_submissions; r public.requirements; v_cycle uuid; v_exp date; v_iss date; p public.people; v_tok uuid; v_org text; v_app text := private.setting('app_url');
begin
  select * into s from public.worker_submissions where id = p_submission for update;
  if s.id is null or s.org_id not in (select private.my_writable_org_ids()) then raise exception 'Not found.' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'This was already decided.' using errcode = 'P0001'; end if;
  select * into r from public.requirements where id = s.requirement_id and deleted_at is null;
  if r.id is null then raise exception 'This license was deleted.' using errcode = 'P0001'; end if;
  select * into p from public.people where id = s.person_id;
  if not coalesce(p_approve, false) then
    update public.worker_submissions set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(left(btrim(p_note), 300), '')
    where id = s.id;
    if p.email is not null and p.deleted_at is null and p.paused_at is null then
      v_tok := private.worker_link_for(r.id);
      select name into v_org from public.orgs where id = s.org_id;
      insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
      values (s.org_id, 'email', p.email, 'Please send your ' || r.name || ' again',
        'Hi ' || split_part(btrim(p.full_name), ' ', 1) || E',\n\n' || v_org || ' couldn''t use the photo you sent' ||
          coalesce(': ' || nullif(btrim(p_note), ''), '.') || E'\n\nSend a new one here (no account needed):\n' || v_app || '#/w/' || v_tok ||
          E'\n\nSent by PermitPal for ' || v_org || '.',
        private.email_html('Please send your ' || r.name || ' again',
          '<p>Hi ' || private.html_escape(split_part(btrim(p.full_name), ' ', 1)) || ',</p><p>' || private.html_escape(v_org) || ' couldn''t use the photo you sent'
            || coalesce(': <b>' || private.html_escape(nullif(btrim(p_note), '')) || '</b>', '.') || '</p><p>Send a new one with the button below. No account needed.</p>'
            || '<p style="color:#6B7585;font-size:13px">Sent by PermitPal for ' || private.html_escape(v_org) || '.</p>',
          'Send a new photo', v_app || '#/w/' || v_tok),
        'wrej:' || s.id);
    end if;
    return null;
  end if;
  v_exp := coalesce(p_expires, s.expires_on);
  v_iss := coalesce(p_issued, s.issued_on);
  if r.expires and v_exp is null then raise exception 'Enter the expiry date.' using errcode = '22023'; end if;
  if v_iss is not null and v_exp is not null and v_iss > v_exp then raise exception 'The issue date is after the expiry date.' using errcode = '22023'; end if;
  insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on)
  values (s.org_id, s.requirement_id, coalesce(nullif(left(btrim(p_ref), 100), ''), s.reference_no), v_iss, case when r.expires then v_exp end)
  returning id into v_cycle;
  insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name, mime_type, size_bytes)
  values (s.org_id, s.requirement_id, v_cycle, s.storage_path, s.file_name, s.mime_type, s.size_bytes);
  update public.worker_submissions set status = 'approved', decided_by = auth.uid(), decided_at = now(), cycle_id = v_cycle,
    decision_note = nullif(left(btrim(p_note), 300), '') where id = s.id;
  return v_cycle;
end $function$;

-- Spelling: license.
CREATE OR REPLACE FUNCTION private.audit_scan(p_org uuid)
 RETURNS TABLE(key text, kind text, severity text, title text, detail text, action text, requirement_id uuid, business_id uuid, location_id uuid, vehicle_id uuid, person_id uuid, type_code text, fingerprint text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with today as (select private.today_ph() as d),
  items as (
    select rs.*, t.due_rule,
      coalesce(rs.subject_name, '') || case when rs.location_id is not null and not coalesce(rs.location_is_main, true) then ' (' || rs.location_name || ')' else '' end
        || case when coalesce(rs.plate_no, '') <> '' then ' · ' || rs.plate_no else '' end as who,
      regexp_replace(lower(rs.name), '[^a-z0-9]+', '', 'g') as norm,
      array(select distinct w from regexp_split_to_table(replace(lower(rs.name), '''', ''), '[^a-z0-9]+') w
            where w <> '' and w not in ('of','the','and','for','to','a','an','ng','sa','or')) as words
    from public.requirement_status rs
    left join public.requirement_types t on t.code = rs.type_code
    left join public.people p on p.id = rs.person_id
    where rs.org_id = p_org and (rs.person_id is null or p.paused_at is null)
  ),
  facts as (
    -- expired, and nobody has started renewing it
    select 'expired:' || i.id, 'expired', 'fix',
      i.name || ' expired ' || private.fmt_date(i.expires_on),
      i.who || '. Renew it, or if it''s already renewed, add the new expiry date and copy.', 'renew',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, i.cycle_id::text
    from items i where i.status = 'action_required'
    union all
    -- nothing recorded yet
    select 'nodetails:' || i.id, 'no_details', 'fix', 'No details for ' || i.name || ' yet',
      i.who || '. Add the reference number' || case when i.expires then ', expiry date' else '' end || ' and a copy, or remove it if it doesn''t apply.', 'add_details',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, 'none'
    from items i where i.cycle_id is null
    union all
    -- recorded, but no expiry date
    select 'noexpiry:' || i.id, 'no_expiry', 'fix', 'Expiry date missing: ' || i.name,
      i.who || '. Without it we can''t remind you before it lapses.', 'add_details',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, i.cycle_id::text
    from items i where i.cycle_id is not null and i.expires and i.expires_on is null
    union all
    -- recorded, but no copy uploaded
    select 'nocopy:' || i.id, 'no_copy', 'fix', 'No copy uploaded: ' || i.name,
      i.who || '. Upload a photo or scan, so it''s ready when an inspector or client asks.', 'upload',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, i.cycle_id::text
    from items i where i.cycle_id is not null and i.document_count = 0 and not (i.expires and i.expires_on is null)
    union all
    -- coming up in the next 60 days
    select 'soon:' || i.id, 'due_soon', 'soon',
      i.name || ' expires ' || private.fmt_date(i.expires_on) || ' (in ' || i.days_left || ' day' || case when i.days_left = 1 then '' else 's' end || ')',
      i.who || '. Start the renewal early: offices get busy near deadlines.', 'renew',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, i.cycle_id::text
    from items i where i.expires and i.expires_on is not null and i.days_left between 0 and 60 and i.status <> 'in_progress'
    union all
    -- dates that look off (asked, not stated)
    select 'dates:' || i.id, 'date_check', 'confirm',
      case when i.issued_on > (select d from today) + 1 then 'Is the issue date right? ' || i.name
           else 'Is the expiry date right? ' || i.name end,
      i.who || case
        when i.issued_on > (select d from today) + 1 then '. It says it was issued on ' || private.fmt_date(i.issued_on) || ', which is in the future.'
        when private.usual_months(i.due_rule) is not null then '. It says it''s valid until ' || private.fmt_date(i.expires_on) ||
          ', but this kind usually lasts up to ' || case private.usual_months(i.due_rule) when 13 then 'a year' when 7 then '6 months' when 25 then '2 years' when 37 then '3 years' else '5 years' end || '.'
        else '. It says it''s valid until ' || private.fmt_date(i.expires_on) || ', more than 10 years from now.' end,
      'review', i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code,
      i.cycle_id::text || ':' || coalesce(i.issued_on::text, '') || ':' || coalesce(i.expires_on::text, '')
    from items i
    where i.cycle_id is not null and (
      i.issued_on > (select d from today) + 1
      or (i.expires_on is not null and private.usual_months(i.due_rule) is not null
          and i.expires_on > coalesce(i.issued_on, (select d from today)) + make_interval(months => private.usual_months(i.due_rule)) + interval '31 days')
      or (i.expires_on is not null and private.usual_months(i.due_rule) is null and i.expires_on > (select d from today) + interval '10 years'))
    union all
    -- the photo seems to show a different expiry date than the one saved (read on the customer's phone)
    select 'photodate:' || i.id, 'photo_date', 'confirm', 'Which expiry date is right? ' || i.name,
      i.who || '. The uploaded photo seems to say ' || private.fmt_date((d.reading -> 'expires' ->> 0)::date) || ', but ' || private.fmt_date(i.expires_on) ||
        ' is saved. Photos can be misread, so check the paper.',
      'review', i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, d.id::text || ':' || i.expires_on::text
    from items i
    join lateral (select x.id, x.reading from public.documents x where x.cycle_id = i.cycle_id and x.deleted_at is null and x.reading ? 'expires'
                  and jsonb_typeof(x.reading -> 'expires') = 'array' and jsonb_array_length(x.reading -> 'expires') > 0
                  order by x.created_at desc limit 1) d on true
    where i.expires_on is not null and (d.reading -> 'expires' ->> 0) ~ '^\d{4}-\d{2}-\d{2}$'
      and not exists (select 1 from jsonb_array_elements_text(d.reading -> 'expires') e where e = i.expires_on::text)
    union all
    -- the photo looks like a different kind of document
    select 'photokind:' || i.id, 'photo_kind', 'confirm', 'Is this the right file? ' || i.name,
      i.who || '. The uploaded photo looks like a ' || coalesce((select t.name from public.requirement_types t where t.code = d.reading ->> 'kind'), d.reading ->> 'kind') ||
        '. If the wrong file was uploaded, replace it.',
      'review', i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, d.id::text
    from items i
    join lateral (select x.id, x.reading from public.documents x where x.cycle_id = i.cycle_id and x.deleted_at is null and x.reading ? 'kind'
                  order by x.created_at desc limit 1) d on true
    where i.type_code is not null and d.reading ->> 'kind' is not null and d.reading ->> 'kind' <> i.type_code
      and exists (select 1 from public.requirement_types t where t.code = d.reading ->> 'kind')
    union all
    -- listed twice (same name for the same business/branch, vehicle or person)
    select 'twice:' || a.id || ':' || b.id, 'duplicate', 'confirm', 'Listed twice? ' || a.name,
      a.who || ' has "' || a.name || '" and "' || b.name || '". If they''re the same permit, remove one.', 'review',
      a.id, a.business_id, a.location_id, a.vehicle_id, a.person_id, a.type_code, 'v1'
    from items a join items b on a.id < b.id
      and a.business_id is not distinct from b.business_id
      and (a.location_id is not distinct from b.location_id or a.location_id is null or b.location_id is null)
      and a.vehicle_id is not distinct from b.vehicle_id and a.person_id is not distinct from b.person_id
      and (a.type_code is null or b.type_code is null or a.type_code = b.type_code)
      and (a.norm = b.norm or (least(cardinality(a.words), cardinality(b.words)) >= 2 and (a.words <@ b.words or b.words <@ a.words)))
  ),
  common as (
    -- what businesses like this usually need, missing from the list (the business can say it doesn't apply)
    select 'common:' || b.id || ':' || coalesce(l.id::text, '-') || ':' || t.code, 'missing_common', 'confirm',
      'Do you need a ' || t.name || '?',
      'Most ' || case b.activity when 'restaurant' then 'restaurants and food businesses' when 'retail' then 'stores' when 'healthcare' then 'clinics'
        when 'school' then 'schools' when 'construction' then 'construction businesses' when 'manufacturing' then 'manufacturers' else 'businesses like yours' end ||
        ' need one, and it isn''t on ' || b.name || case when l.id is not null and not l.is_main then ' (' || l.name || ')' else '' end || '''s list. Add it, or tell us it doesn''t apply.',
      'add_permit', null::uuid, b.id, l.id, null::uuid, null::uuid, t.code, 'v1'
    from public.businesses b
    join public.requirement_types t on t.subject = 'business' and t.auto_add and t.confidence in ('confirmed','likely')
      and (t.activities is null or b.activity = any(t.activities)) and (t.structures is null or b.structure = any(t.structures))
    left join public.business_locations l on t.per_location and l.business_id = b.id and l.deleted_at is null
    where b.org_id = p_org and b.deleted_at is null and (not t.per_location or l.id is not null)
      and not exists (select 1 from public.requirements r where r.business_id = b.id and r.type_code = t.code and r.deleted_at is null
                      and (not t.per_location or r.location_id = l.id or r.location_id is null))
    union all
    -- a vehicle with no registration or no insurance on its list
    select 'vehicle:' || v.id || ':' || t.code, 'vehicle_missing', 'confirm', 'No ' || t.name || ' for ' || coalesce(nullif(v.plate_no, ''), v.make_model) || '?',
      v.make_model || coalesce(' · ' || nullif(v.plate_no, ''), '') || ' has no ' || t.name || ' on its list. Add it, or tell us it doesn''t apply.',
      'add_permit', null, v.business_id, null, v.id, null, t.code, 'v1'
    from public.vehicles v join public.requirement_types t on t.code in ('lto_registration','ctpl')
    where v.org_id = p_org and v.deleted_at is null
      and not exists (select 1 from public.requirements r where r.vehicle_id = v.id and r.type_code = t.code and r.deleted_at is null)
    union all
    -- a branch with nothing on its list
    select 'emptybranch:' || l.id, 'branch_empty', 'confirm', 'Nothing listed for ' || b.name || ' (' || l.name || ')',
      'This branch has no permits on its list. Most branches need their own business permit and fire safety certificate.', 'add_permit',
      null, b.id, l.id, null, null, null, 'v1'
    from public.business_locations l join public.businesses b on b.id = l.business_id and b.deleted_at is null
    where l.org_id = p_org and l.deleted_at is null and not l.is_main
      and not exists (select 1 from public.requirements r where r.location_id = l.id and r.deleted_at is null)
  ),
  roles as (
    -- someone in a role is missing a license the business said that role needs
    select 'role:' || p.id || ':' || t.code, 'role_missing', 'fix', p.full_name || ' needs a ' || t.name,
      'Your rule for ' || sr.name || ': ' || (select string_agg(tt.name, ', ' order by tt.sort) from public.requirement_types tt where tt.code = any(sr.type_codes)) ||
        '. Add it to ' || split_part(btrim(p.full_name), ' ', 1) || '''s list.', 'add_licence',
      null::uuid, p.business_id, null::uuid, null::uuid, p.id, t.code, array_to_string(sr.type_codes, ',')
    from public.people p
    join public.staff_roles sr on sr.org_id = p.org_id and lower(btrim(sr.name)) = lower(btrim(p.role_title))
    join public.requirement_types t on t.code = any(sr.type_codes)
    where p.org_id = p_org and p.deleted_at is null and p.paused_at is null
      and not exists (select 1 from public.requirements r where r.person_id = p.id and r.type_code = t.code and r.deleted_at is null)
  )
  select * from facts union all select * from common union all select * from roles
$function$;

-- Spelling: license, color.
CREATE OR REPLACE FUNCTION public.admin_money(p_from date, p_to date)
 RETURNS TABLE(day date, stream text, kind text, state text, amount numeric, label text, who text, ref_kind text, ref_id uuid, invoice_no text, rush numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    union all
    -- PermitPal Plus and staff licenses
    select private.ph_day(i.paid_at), 'plans', case i.kind when 'plus' then 'plus' when 'brand' then 'white_label' else 'staff_licences' end, 'collected', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, i.bir_invoice_no, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0 and i.paid_at is not null
    union all
    select private.ph_day(i.created_at), 'plans', case i.kind when 'plus' then 'plus' when 'brand' then 'white_label' else 'staff_licences' end, 'to_collect', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, null, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
  )
  select l.day, l.stream, l.kind, l.state, l.amount, l.label, l.who, l.ref_kind, l.ref_id, l.invoice_no, l.rush from lines l
  where l.day between p_from and p_to or l.state in ('to_collect','pipeline','unbilled','to_pay')
  order by l.day desc, l.stream;
end $function$;

-- Spelling: license, color.
CREATE OR REPLACE FUNCTION public.brand_save(p_org uuid, p_name text, p_logo_path text, p_color text, p_reply_to text, p_phone text, p_tagline text, p_client_report boolean DEFAULT true)
 RETURNS org_brands
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.org_brands; v_email text := nullif(lower(btrim(coalesce(p_reply_to, ''))), '');
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can change the brand.' using errcode = '42501'; end if;
  if not exists (select 1 from public.orgs where id = p_org and kind = 'firm') then raise exception 'White-label is for Accounting firm workspaces.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Enter the name your clients know you by (up to 80 characters).' using errcode = '22023'; end if;
  if not private.color_ok(coalesce(p_color, '')) then raise exception 'Pick a darker color, so white text on it stays easy to read.' using errcode = '22023'; end if;
  if v_email is not null and v_email !~* '^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$' then raise exception 'Enter a valid email address for replies.' using errcode = '22023'; end if;
  if p_logo_path is not null and split_part(p_logo_path, '/', 1) <> p_org::text then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  insert into public.org_brands (org_id, display_name, logo_path, color, reply_to, phone, tagline, client_report)
  values (p_org, btrim(p_name), p_logo_path, upper(p_color), v_email, nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_tagline, '')), ''), coalesce(p_client_report, true))
  on conflict (org_id) do update set display_name = excluded.display_name, logo_path = excluded.logo_path, color = excluded.color,
    reply_to = excluded.reply_to, phone = excluded.phone, tagline = excluded.tagline, client_report = excluded.client_report, updated_at = now()
  returning * into v;
  return v;
end $function$;

insert into private.features (name) values ('property_s') on conflict do nothing;
