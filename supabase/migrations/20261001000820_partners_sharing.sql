-- Payment details, partner referrals with commission tracking, shareable proof-of-compliance links, and a summary across workspaces.

-- ================================================================ payment details shown to customers
create table public.app_settings (
  key         text primary key check (key in ('gcash_name','gcash_number','bank_name','bank_account_name','bank_account_number',
                                              'payment_note','online_payments','support_phone','support_email')),
  value       text not null default '' check (length(value) <= 500),
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy app_settings_read on public.app_settings for select to authenticated using (true);
create policy app_settings_admin_insert on public.app_settings for insert to authenticated with check ((select private.is_platform_admin()));
create policy app_settings_admin_update on public.app_settings for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke delete on public.app_settings from anon, authenticated;
revoke all on public.app_settings from anon;
insert into public.app_settings (key, value) values
  ('gcash_name', ''), ('gcash_number', ''), ('bank_name', ''), ('bank_account_name', ''), ('bank_account_number', ''),
  ('payment_note', 'Send the exact amount and enter the reference number below. We confirm within 1 business day.'),
  ('online_payments', 'off'), ('support_phone', ''), ('support_email', '');

-- ================================================================ partners and referrals
-- Partners are businesses customers need anyway (insurers, emission centers, pest control...).
-- Commission terms live only in staff-only columns/tables.
create table public.partners (
  id              uuid primary key default gen_random_uuid(),
  category        text not null check (category in ('insurance','emission_testing','vehicle_inspection','pest_control','fire_safety',
                                                     'health_clinic','notary','bookkeeping','other')),
  name            text not null check (length(btrim(name)) between 1 and 160),
  description     text not null default '' check (length(description) <= 600),
  offer           text not null default '' check (length(offer) <= 200),
  coverage        text not null default '' check (length(coverage) <= 200),
  contact_name    text not null default '' check (length(contact_name) <= 120),
  contact_phone   text not null default '' check (length(contact_phone) <= 60),
  contact_email   text not null default '' check (length(contact_email) <= 160),
  website         text not null default '' check (length(website) <= 300),
  type_codes      text[] not null default '{}',
  commission_terms text not null default '' check (length(commission_terms) <= 500),
  published       boolean not null default false,
  sort            int not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger partners_touch before update on public.partners for each row execute function private.touch_updated_at();
alter table public.partners enable row level security;
create policy partners_admin_read on public.partners for select to authenticated using ((select private.is_platform_admin()));
create policy partners_admin_insert on public.partners for insert to authenticated with check ((select private.is_platform_admin()));
create policy partners_admin_update on public.partners for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke delete on public.partners from anon, authenticated;
revoke all on public.partners from anon;

-- What customers see: published partners, without commission terms or private contact details.
create function public.list_partners() returns table (
  id uuid, category text, name text, description text, offer text, coverage text, website text, type_codes text[])
language sql stable security definer set search_path = '' as $$
  select p.id, p.category, p.name, p.description, p.offer, p.coverage, p.website, p.type_codes
  from public.partners p where p.published order by p.sort, p.name
$$;
revoke execute on function public.list_partners() from public, anon;
grant execute on function public.list_partners() to authenticated;

create table public.referrals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  partner_id      uuid not null references public.partners(id) on delete restrict,
  requirement_id  uuid references public.requirements(id) on delete set null,
  note            text check (note is null or length(note) <= 1000),
  contact_method  text not null default 'email' check (contact_method in ('email','phone','whatsapp','viber')),
  contact_value   text check (contact_value is null or length(contact_value) <= 120),
  status          text not null default 'requested' check (status in ('requested','introduced','converted','not_converted')),
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index referrals_org_idx on public.referrals(org_id, created_at desc);
create trigger referrals_touch before update on public.referrals for each row execute function private.touch_updated_at();
alter table public.referrals enable row level security;
create policy referrals_read on public.referrals for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
create policy referrals_admin_update on public.referrals for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke insert, delete on public.referrals from anon, authenticated;
revoke all on public.referrals from anon;

create table public.referral_commissions (
  referral_id  uuid primary key references public.referrals(id) on delete cascade,
  amount_php   numeric(12,2) not null default 0 check (amount_php >= 0),
  status       text not null default 'expected' check (status in ('expected','earned','paid','none')),
  note         text check (note is null or length(note) <= 500),
  paid_at      timestamptz,
  updated_at   timestamptz not null default now()
);
create trigger referral_commissions_touch before update on public.referral_commissions for each row execute function private.touch_updated_at();
alter table public.referral_commissions enable row level security;
create policy referral_commissions_admin on public.referral_commissions for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke all on public.referral_commissions from anon;

create function public.request_referral(p_org uuid, p_partner uuid, p_requirement uuid default null, p_note text default null,
  p_contact_method text default 'email', p_contact_value text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_partner public.partners; v_org text; v_who text;
begin
  if p_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_partner from public.partners where id = p_partner and published;
  if v_partner.id is null then raise exception 'That partner is not available.' using errcode = '23503'; end if;
  if p_requirement is not null and not exists (select 1 from public.requirements where id = p_requirement and org_id = p_org) then
    raise exception 'That requirement was not found.' using errcode = '23503';
  end if;
  insert into public.referrals (org_id, partner_id, requirement_id, note, contact_method, contact_value)
  values (p_org, p_partner, p_requirement, nullif(btrim(p_note), ''), coalesce(p_contact_method, 'email'), nullif(btrim(p_contact_value), ''))
  returning id into v_id;
  insert into public.referral_commissions (referral_id) values (v_id);
  select name into v_org from public.orgs where id = p_org;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) || ' (' || email || ')' into v_who from public.profiles where id = auth.uid();
  perform private.notify_admins('Introduction request: ' || v_partner.name,
    v_org || ' - ' || coalesce(v_who, '-') || ' - contact via ' || coalesce(p_contact_method, 'email') || coalesce(': ' || p_contact_value, '') ||
    coalesce('. Note: ' || p_note, ''), 'ref:' || v_id, true);
  return v_id;
end $$;
revoke execute on function public.request_referral(uuid,uuid,uuid,text,text,text) from public, anon;
grant execute on function public.request_referral(uuid,uuid,uuid,text,text,text) to authenticated;

-- ================================================================ shareable proof of compliance
create table public.compliance_shares (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  token        text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  scope        text not null default 'org' check (scope in ('org','business','vehicle','person')),
  subject_id   uuid,
  label        text not null default '' check (length(label) <= 160),
  show_refs    boolean not null default true,
  expires_at   timestamptz not null default now() + interval '30 days',
  revoked_at   timestamptz,
  view_count   int not null default 0,
  last_viewed_at timestamptz,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check ((scope = 'org') = (subject_id is null)),
  check (expires_at <= created_at + interval '366 days')
);
create index compliance_shares_org_idx on public.compliance_shares(org_id, created_at desc);
alter table public.compliance_shares enable row level security;
create policy compliance_shares_read on public.compliance_shares for select to authenticated using (org_id in (select private.my_org_ids()));
create policy compliance_shares_insert on public.compliance_shares for insert to authenticated with check (org_id in (select private.my_writable_org_ids()));
create policy compliance_shares_update on public.compliance_shares for update to authenticated
  using (org_id in (select private.my_writable_org_ids())) with check (org_id in (select private.my_writable_org_ids()));
revoke delete on public.compliance_shares from anon, authenticated;
revoke all on public.compliance_shares from anon;

-- Anyone with the link sees a read-only summary (no files, no notes). Links expire and can be revoked.
create function public.get_shared_compliance(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.compliance_shares; v_items jsonb; v_org text;
begin
  select * into v_s from public.compliance_shares where token = p_token;
  if v_s.id is null or v_s.revoked_at is not null or v_s.expires_at < now() then
    return jsonb_build_object('error', 'This link has expired or was turned off. Ask the business for a new one.');
  end if;
  select name into v_org from public.orgs where id = v_s.org_id and deleted_at is null;
  if v_org is null then return jsonb_build_object('error', 'This link is no longer available.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', rs.name, 'subject', rs.subject, 'subject_name', rs.subject_name, 'plate_no', rs.plate_no,
      'location', case when rs.location_id is not null then concat_ws(', ', rs.location_name, nullif(rs.location_city, '')) end,
      'status', rs.status, 'expires', rs.expires, 'expires_on', rs.expires_on, 'issued_on', rs.issued_on,
      'reference_no', case when v_s.show_refs then rs.reference_no end, 'issuer', rs.issuer, 'on_file', rs.document_count > 0)
      order by rs.subject, rs.subject_name, rs.location_name nulls first, rs.name), '[]'::jsonb)
    into v_items
  from public.requirement_status rs
  where rs.org_id = v_s.org_id
    and (v_s.scope = 'org'
      or (v_s.scope = 'business' and rs.business_id = v_s.subject_id)
      or (v_s.scope = 'vehicle' and rs.vehicle_id = v_s.subject_id)
      or (v_s.scope = 'person' and rs.person_id = v_s.subject_id));
  update public.compliance_shares set view_count = view_count + 1, last_viewed_at = now() where id = v_s.id;
  return jsonb_build_object('org_name', v_org, 'label', v_s.label, 'generated_at', now(), 'as_of', private.today_ph(),
    'expires_at', v_s.expires_at, 'items', v_items);
end $$;
revoke execute on function public.get_shared_compliance(text) from public;
grant execute on function public.get_shared_compliance(text) to anon, authenticated;

-- ================================================================ every workspace at a glance (consultants, accountants)
create function public.my_workspaces() returns table (
  org_id uuid, name text, role text, total int, overdue int, soon int, in_progress int, needs_info int, compliant int)
language sql stable security invoker set search_path = '' as $$
  select o.id, o.name, m.role,
    count(rs.id)::int,
    count(*) filter (where rs.status = 'action_required')::int,
    count(*) filter (where rs.status = 'renew_soon')::int,
    count(*) filter (where rs.status = 'in_progress')::int,
    count(*) filter (where rs.status = 'needs_information')::int,
    count(*) filter (where rs.status = 'compliant')::int
  from public.org_members m
  join public.orgs o on o.id = m.org_id and o.deleted_at is null
  left join public.requirement_status rs on rs.org_id = o.id
  where m.user_id = auth.uid()
  group by o.id, o.name, m.role
  order by o.name
$$;
revoke execute on function public.my_workspaces() from public, anon;
grant execute on function public.my_workspaces() to authenticated;
