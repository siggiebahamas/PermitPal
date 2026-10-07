-- Team tools (the paid side of PermitPal; single businesses stay free):
--   head_office  franchisors and chains: every branch and franchisee on one board
--   firm         accounting / bookkeeping firms: every client on one board, one-click reminders
--   property     malls and landlords: every tenant's permits, with copies when the tenant allows
--   fleet        fleet operators: every vehicle's registration and insurance on one board
-- Other companies connect their own workspace to yours (franchisee, client, tenant). They keep
-- full control: they choose to connect, choose whether you may download copies, and can
-- disconnect anytime. You only ever see permit names, statuses and dates.
-- Also: licensed professionals directory (lead-based) replaces done-for-you services.

-- ================================================================ workspace profile
alter table public.orgs
  add column if not exists kind text not null default 'business' check (kind in ('business','head_office','firm','property','fleet')),
  add column if not exists contact_name text check (length(contact_name) <= 120),
  add column if not exists contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists required_types text[] not null default '{}',
  add column if not exists trial_ends_at timestamptz,
  add column if not exists last_nudged_at timestamptz;

-- Workspace admins may rename and set the profile directly; everything about plans, trials,
-- deletion and history only changes through the server functions or staff.
create or replace function private.orgs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and not coalesce(private.is_platform_admin(), false) then
    new.plan_id := old.plan_id; new.plan_expires_at := old.plan_expires_at; new.created_by := old.created_by;
    new.created_at := old.created_at; new.deleted_at := old.deleted_at; new.purge_after := old.purge_after;
    new.trial_ends_at := old.trial_ends_at; new.last_nudged_at := old.last_nudged_at;
  end if;
  -- Choosing a team workspace type starts the 30-day free trial once.
  if new.kind <> 'business' and new.trial_ends_at is null then new.trial_ends_at := now() + interval '30 days'; end if;
  return new;
end $$;
create trigger orgs_guard before update on public.orgs for each row execute function private.orgs_guard();

-- ================================================================ plans
insert into public.plans (id, name, price_php_monthly, max_businesses, max_vehicles, max_members, max_locations_per_business, paid_channels, features, sort, available) values
  ('fleet', 'Fleet', 1490, null, null, null, null, false,
    array['Fleet board: every vehicle''s registration, CTPL, emission and inspection','Import vehicles from a spreadsheet','Plate-schedule due dates','Export for your records','Everything in Free'], 10, true),
  ('firm', 'Accounting firm', 1990, null, null, null, null, false,
    array['Client board: every client''s permits on one screen','One-click reminders to clients','Connect clients'' own workspaces or manage them for them','Everything in Free'], 11, true),
  ('head_office', 'Head office', 4990, null, null, null, null, false,
    array['Branch board: every branch and franchisee on one screen','Franchisees connect their own workspaces','One-click reminders to branches','Export for audits','Everything in Free'], 12, true),
  ('property', 'Property', 9990, null, null, null, null, false,
    array['Tenant board: every tenant''s permits on one screen','Choose which permits tenants must keep current','Download tenants'' shared copies','One-click reminders to tenants','Everything in Free'], 13, true)
on conflict (id) do nothing;

create or replace function private.team_plan_for(p_kind text) returns text language sql immutable set search_path = '' as $$
  select case p_kind when 'head_office' then 'head_office' when 'firm' then 'firm' when 'property' then 'property' when 'fleet' then 'fleet' end
$$;

-- Team tools are on while the matching plan is active, during the trial, or for staff.
create or replace function private.has_team_tools(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_platform_admin(), false) or exists (
    select 1 from public.orgs o where o.id = p_org and o.deleted_at is null and o.kind <> 'business' and (
      (o.trial_ends_at is not null and o.trial_ends_at > now())
      or private.effective_plan_id(o.id) in ('fleet','firm','head_office','property')))
$$;
grant execute on function private.has_team_tools(uuid) to authenticated;

create or replace function private.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = auth.uid() and m.role in ('owner','admin'))
$$;
grant execute on function private.is_org_admin(uuid) to authenticated;

-- Ask to switch to a paid plan when online payment is off: tells PermitPal staff.
create function public.request_plan(p_org uuid, p_plan text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org public.orgs; v_plan public.plans; v_who text;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can change the plan.' using errcode = '42501'; end if;
  select * into v_org from public.orgs where id = p_org;
  select * into v_plan from public.plans where id = p_plan and available;
  if v_plan.id is null then raise exception 'That plan is not available.' using errcode = 'P0001'; end if;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) || ' (' || email || ')' into v_who from public.profiles where id = auth.uid();
  perform private.notify_admins('Plan request: ' || v_plan.name || ' for ' || v_org.name,
    coalesce(v_who, '-') || ' wants the ' || v_plan.name || ' plan (₱' || v_plan.price_php_monthly || '/month).' || coalesce(' Note: ' || nullif(btrim(p_note), ''), ''),
    'planreq:' || p_org || ':' || p_plan || ':' || to_char(now(), 'YYYYMMDD'), true);
end $$;
revoke execute on function public.request_plan(uuid,text,text) from public, anon;
grant execute on function public.request_plan(uuid,text,text) to authenticated;

-- ================================================================ connected workspaces
create table public.org_links (
  id             uuid primary key default gen_random_uuid(),
  owner_org      uuid not null references public.orgs(id) on delete cascade,
  member_org     uuid references public.orgs(id) on delete cascade,
  relation       text not null check (relation in ('franchisee','client','tenant')),
  label          text not null default '' check (length(label) <= 120),
  invited_email  text not null check (invited_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  token          text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  status         text not null default 'pending' check (status in ('pending','active','declined','ended')),
  share_files    boolean not null default false,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  ended_at       timestamptz,
  last_nudged_at timestamptz,
  check (member_org is null or member_org <> owner_org)
);
create index org_links_owner on public.org_links(owner_org, status);
create index org_links_member on public.org_links(member_org, status);
create unique index org_links_one_active on public.org_links(owner_org, member_org) where status = 'active';
alter table public.org_links enable row level security;
-- Both sides can see the connection; the token stays visible only to the inviting side.
create policy org_links_read on public.org_links for select to authenticated
  using (owner_org in (select private.my_org_ids()) or member_org in (select private.my_org_ids()));
revoke all on public.org_links from anon;

create or replace function private.relation_label(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'franchisee' then 'branch or franchisee' when 'client' then 'client' when 'tenant' then 'tenant' else p end
$$;

-- Invite another company to connect its workspace (by email).
create function public.link_invite(p_owner uuid, p_relation text, p_email text, p_label text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org public.orgs; v_id uuid; v_token text; v_email text := lower(btrim(p_email)); v_url text; v_who text;
begin
  if not private.is_org_admin(p_owner) then raise exception 'Only the workspace owner or an admin can invite.' using errcode = '42501'; end if;
  if not private.has_team_tools(p_owner) then raise exception 'Your trial has ended. Choose a plan in Settings → Plan to keep connecting.' using errcode = 'P0001', hint = 'plan_limit'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address.' using errcode = '22023'; end if;
  select * into v_org from public.orgs where id = p_owner;
  select id, token into v_id, v_token from public.org_links where owner_org = p_owner and invited_email = v_email and status = 'pending';
  if v_id is null then
    insert into public.org_links (owner_org, relation, label, invited_email, created_by)
    values (p_owner, p_relation, left(coalesce(btrim(p_label), ''), 120), v_email, auth.uid()) returning id, token into v_id, v_token;
  end if;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) into v_who from public.profiles where id = auth.uid();
  v_url := coalesce(private.setting('app_url'), '') || '#/connect/' || v_token;
  insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
  values (p_owner, 'email', v_email, v_org.name || ' invites you to connect on PermitPal',
    v_who || ' of ' || v_org.name || ' would like to see the status of your permits (names, status and expiry dates only) as their '
      || private.relation_label(p_relation) || '. PermitPal is free for your business. Open this link to accept or decline: ' || v_url,
    private.email_html(v_org.name || ' invites you to connect',
      '<p>' || private.html_escape(coalesce(v_who, 'Someone')) || ' of <b>' || private.html_escape(v_org.name) || '</b> would like to see the status of your permits as their '
      || private.relation_label(p_relation) || '.</p><p>They will see permit names, status and expiry dates only. You decide whether they may download copies, and you can disconnect anytime. PermitPal is free for your business.</p>',
      'Review the invitation', v_url),
    'linkinv:' || v_id || ':' || to_char(now(), 'YYYYMMDDHH24'))
  on conflict (dedupe_key) do nothing;
  return v_id;
end $$;

create function public.link_preview(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('owner_name', o.name, 'owner_kind', o.kind, 'relation', l.relation, 'label', l.label,
    'invited_email', l.invited_email, 'required_types', o.required_types,
    'status', l.status)
  from public.org_links l join public.orgs o on o.id = l.owner_org where l.token = p_token
$$;

create function public.link_accept(p_token text, p_member_org uuid, p_share_files boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_l public.org_links; v_member text; v_m record;
begin
  if not private.is_org_admin(p_member_org) then raise exception 'Only the owner or an admin of that workspace can connect it.' using errcode = '42501'; end if;
  select * into v_l from public.org_links where token = p_token for update;
  if v_l.id is null or v_l.status <> 'pending' then raise exception 'This invitation is no longer open. Ask for a new one.' using errcode = 'P0001'; end if;
  if v_l.owner_org = p_member_org then raise exception 'Choose your own business workspace, not the one that invited you.' using errcode = '22023'; end if;
  if exists (select 1 from public.org_links where owner_org = v_l.owner_org and member_org = p_member_org and status = 'active') then
    raise exception 'That workspace is already connected.' using errcode = 'P0001';
  end if;
  update public.org_links set member_org = p_member_org, status = 'active', share_files = coalesce(p_share_files, false), accepted_at = now()
   where id = v_l.id;
  select name into v_member from public.orgs where id = p_member_org;
  for v_m in select user_id from public.org_members where org_id = v_l.owner_org and role in ('owner','admin') loop
    perform private.notify(v_m.user_id, v_l.owner_org, 'team', v_member || ' connected',
      'Their permit status now shows on your board.' || case when p_share_files then ' They also share copies of their permits.' else '' end,
      '#/network', null, 'linkok:' || v_l.id || ':' || v_m.user_id, true);
  end loop;
  return v_l.id;
end $$;

create function public.link_decline(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '28000'; end if;
  update public.org_links set status = 'declined', ended_at = now() where token = p_token and status = 'pending';
end $$;

-- Either side can end a connection; only the connected business can change file sharing.
create function public.link_end(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l public.org_links;
begin
  select * into v_l from public.org_links where id = p_link;
  if v_l.id is null or not (private.is_org_admin(v_l.owner_org) or (v_l.member_org is not null and private.is_org_admin(v_l.member_org))) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.org_links set status = case when status = 'pending' then 'declined' else 'ended' end, ended_at = now(), share_files = false
   where id = p_link and status in ('pending','active');
end $$;

create function public.link_set_sharing(p_link uuid, p_share boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l public.org_links;
begin
  select * into v_l from public.org_links where id = p_link;
  if v_l.member_org is null or not private.is_org_admin(v_l.member_org) then raise exception 'Only the connected business can change this.' using errcode = '42501'; end if;
  update public.org_links set share_files = coalesce(p_share, false) where id = p_link and status = 'active';
end $$;

create function public.link_set_label(p_link uuid, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l public.org_links;
begin
  select * into v_l from public.org_links where id = p_link;
  if v_l.id is null or not private.is_org_admin(v_l.owner_org) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update public.org_links set label = left(coalesce(btrim(p_label), ''), 120) where id = p_link;
end $$;

-- The board: every connected (and, for firms, managed) workspace with its permits.
create function public.network_board(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text; v_rows jsonb;
begin
  if p_owner not in (select private.my_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not private.has_team_tools(p_owner) then
    return jsonb_build_object('locked', true);
  end if;
  select kind into v_kind from public.orgs where id = p_owner;
  with members as (
    select l.id link_id, l.member_org org_id, l.relation, l.label, l.status, l.share_files, l.invited_email,
           l.created_at, l.accepted_at, l.last_nudged_at, 'linked' via
    from public.org_links l where l.owner_org = p_owner and l.status in ('pending','active')
    union all
    -- Accounting firms also see client workspaces they manage themselves.
    select null::uuid, o.id, 'client', '', 'active', true, o.contact_email, o.created_at, o.created_at, o.last_nudged_at, 'managed'
    from public.orgs o join public.org_members m on m.org_id = o.id and m.user_id = auth.uid()
    where v_kind = 'firm' and o.id <> p_owner and o.deleted_at is null and o.kind = 'business'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'link_id', mb.link_id, 'org_id', mb.org_id, 'relation', mb.relation, 'label', mb.label, 'status', mb.status,
      'share_files', mb.share_files, 'invited_email', mb.invited_email, 'via', mb.via, 'created_at', mb.created_at,
      'accepted_at', mb.accepted_at, 'last_nudged_at', mb.last_nudged_at,
      'name', o.name, 'contact_name', o.contact_name, 'contact_email', o.contact_email,
      'items', case when mb.status = 'active' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', rs.id, 'type_code', rs.type_code, 'name', rs.name, 'subject', rs.subject, 'subject_name', rs.subject_name,
          'plate_no', rs.plate_no, 'location', rs.location_name, 'city', rs.location_city, 'status', rs.status,
          'expires_on', rs.expires_on, 'days_left', rs.days_left, 'on_file', rs.document_count > 0)
          order by rs.subject_name, rs.name), '[]'::jsonb)
        from public.requirement_status rs where rs.org_id = mb.org_id) else '[]'::jsonb end)
      order by o.name nulls last, mb.invited_email), '[]'::jsonb)
    into v_rows
  from members mb left join public.orgs o on o.id = mb.org_id and o.deleted_at is null;
  return jsonb_build_object('locked', false, 'kind', v_kind, 'members', v_rows);
end $$;

-- Current permit copies a connected business chose to share (paths the storage rule below lets you read).
create function public.network_documents(p_owner uuid, p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_owner not in (select private.my_org_ids()) or not private.has_team_tools(p_owner) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not exists (select 1 from public.org_links where owner_org = p_owner and member_org = p_member and status = 'active' and share_files) then
    raise exception 'This business has not shared copies with you.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('path', d.storage_path, 'file_name', d.file_name, 'mime_type', d.mime_type,
      'requirement', rs.name, 'subject_name', rs.subject_name, 'expires_on', rs.expires_on) order by rs.subject_name, rs.name), '[]'::jsonb)
    from public.documents d join public.requirement_status rs on rs.cycle_id = d.cycle_id
    where d.org_id = p_member and d.deleted_at is null);
end $$;

create function private.can_read_linked_doc(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    join public.requirement_status rs on rs.cycle_id = d.cycle_id
    join public.org_links l on l.member_org = d.org_id and l.status = 'active' and l.share_files
    where d.storage_path = p_path and d.deleted_at is null
      and l.owner_org in (select private.my_org_ids()) and private.has_team_tools(l.owner_org))
$$;
grant execute on function private.can_read_linked_doc(text) to authenticated;
create policy "documents: connected head offices read shared copies" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and private.can_read_linked_doc(name));

-- One-click reminders to connected businesses (and to managed clients' contact email).
create function public.network_nudge(p_owner uuid, p_links uuid[] default '{}', p_orgs uuid[] default '{}', p_message text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_owner public.orgs; v_l record; v_o record; v_m record; v_sent int := 0; v_sum text; v_msg text := nullif(btrim(p_message), '');
begin
  if not private.is_org_admin(p_owner) then raise exception 'Only the workspace owner or an admin can send reminders.' using errcode = '42501'; end if;
  if not private.has_team_tools(p_owner) then raise exception 'Your trial has ended. Choose a plan in Settings → Plan.' using errcode = 'P0001', hint = 'plan_limit'; end if;
  select * into v_owner from public.orgs where id = p_owner;
  for v_l in select * from public.org_links where id = any(coalesce(p_links, '{}')) and owner_org = p_owner and status = 'active'
                and (last_nudged_at is null or last_nudged_at < now() - interval '20 hours') loop
    select string_agg(n || ' ' || w, ', ') into v_sum from (
      select count(*) filter (where status = 'action_required') n, 'overdue' w, 1 s from public.requirement_status where org_id = v_l.member_org
      union all select count(*) filter (where status = 'renew_soon'), 'due soon', 2 from public.requirement_status where org_id = v_l.member_org
      union all select count(*) filter (where status = 'needs_information'), 'missing details', 3 from public.requirement_status where org_id = v_l.member_org
      order by s) x where n > 0;
    for v_m in select user_id from public.org_members where org_id = v_l.member_org and role in ('owner','admin') loop
      perform private.notify(v_m.user_id, v_l.member_org, 'system', v_owner.name || ' asks you to update your permits',
        coalesce(v_msg || ' ', '') || coalesce('You have ' || v_sum || '.', 'Please check your permits are up to date.'),
        '#/', null, 'nudge:' || v_l.id || ':' || v_m.user_id || ':' || to_char(now(), 'YYYYMMDD'), true);
    end loop;
    update public.org_links set last_nudged_at = now() where id = v_l.id;
    v_sent := v_sent + 1;
  end loop;
  -- Firms: clients they manage themselves get an email at the client contact address.
  for v_o in select o.* from public.orgs o join public.org_members m on m.org_id = o.id and m.user_id = auth.uid()
               where o.id = any(coalesce(p_orgs, '{}')) and o.contact_email is not null and o.deleted_at is null
                 and (o.last_nudged_at is null or o.last_nudged_at < now() - interval '20 hours') loop
    select string_agg(rs.name || coalesce(' (' || rs.subject_name || ')', '') || ': ' ||
             case rs.status when 'action_required' then 'overdue' when 'renew_soon' then 'due ' || private.fmt_date(rs.expires_on) else 'missing details' end, E'\n')
      into v_sum from public.requirement_status rs where rs.org_id = v_o.id and rs.status in ('action_required','renew_soon','needs_information');
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    values (v_o.id, 'email', v_o.contact_email, v_owner.name || ': permits that need your attention',
      'Hi' || coalesce(' ' || v_o.contact_name, '') || ',' || E'\n\n' || coalesce(v_msg || E'\n\n', '') || coalesce(v_sum, 'Everything is up to date.') || E'\n\n' || v_owner.name,
      private.email_html(v_owner.name || ': permits that need your attention',
        '<p>Hi' || coalesce(' ' || private.html_escape(v_o.contact_name), '') || ',</p>' || coalesce('<p>' || private.html_escape(v_msg) || '</p>', '') ||
        '<p style="white-space:pre-line">' || private.html_escape(coalesce(v_sum, 'Everything is up to date.')) || '</p><p>' || private.html_escape(v_owner.name) || '</p>',
        null, null),
      'nudgeorg:' || v_o.id || ':' || to_char(now(), 'YYYYMMDD'))
    on conflict (dedupe_key) do nothing;
    update public.orgs set last_nudged_at = now() where id = v_o.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;

do $$ declare f text; begin
  foreach f in array array['link_invite(uuid,text,text,text)','link_preview(text)','link_accept(text,uuid,boolean)','link_decline(text)',
    'link_end(uuid)','link_set_sharing(uuid,boolean)','link_set_label(uuid,text)','network_board(uuid)','network_documents(uuid,uuid)',
    'network_nudge(uuid,uuid[],uuid[],text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ================================================================ licensed professionals (leads)
alter table public.partners
  add column if not exists cities text[] not null default '{}',
  add column if not exists services text not null default '' check (length(services) <= 600),
  add column if not exists licence text not null default '' check (length(licence) <= 200),
  add column if not exists verified boolean not null default false,
  add column if not exists lead_fee_php numeric(10,2) check (lead_fee_php is null or lead_fee_php >= 0);

create function public.list_professionals() returns table (
  id uuid, category text, name text, description text, services text, licence text, coverage text, cities text[],
  website text, type_codes text[], verified boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.category, p.name, p.description, p.services, p.licence, p.coverage, p.cities, p.website, p.type_codes, p.verified
  from public.partners p where p.published order by p.verified desc, p.sort, p.name
$$;
revoke execute on function public.list_professionals() from public, anon;
grant execute on function public.list_professionals() to authenticated;

-- A quote request goes straight to the professional (the customer agreed to share these details),
-- with a copy to PermitPal staff, and is logged for the per-lead fee.
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
  insert into public.referral_commissions (referral_id, amount_php) values (v_id, v_partner.lead_fee_php);
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

-- Strangers never read these.
revoke all on public.org_links from anon;

-- The connected business's side: who can see my permit status.
create function public.my_connections(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'owner_name', o.name, 'owner_kind', o.kind, 'relation', l.relation,
    'label', l.label, 'share_files', l.share_files, 'accepted_at', l.accepted_at) order by o.name), '[]'::jsonb)
  from public.org_links l join public.orgs o on o.id = l.owner_org
  where l.member_org = p_org and l.status = 'active' and p_org in (select private.my_org_ids())
$$;
revoke execute on function public.my_connections(uuid) from public, anon;
grant execute on function public.my_connections(uuid) to authenticated;
