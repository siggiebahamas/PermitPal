-- Database file 20: who can open a workspace's files, and a record of every open.
-- 1) The owner can switch on "Ask me first": then teammates (members and viewers) need an OK from the owner or an
--    admin to open the files of a permit. Each OK lasts 24 hours or 7 days and covers that one permit. The owner and
--    admins always can. Storage itself enforces it, so no app, link or tool gets around it.
-- 2) Every file opened through the document vault is recorded (who, which file, when); the owner and admins see the
--    list in Settings. The owner can also ask to be told each time a teammate opens one.
-- File names and dates stay visible to the whole team; only the files themselves are locked.

-- ======================================================================== the switch, the OKs, the record
alter table public.orgs
  add column if not exists file_mode text not null default 'open' check (file_mode in ('open', 'ask')),
  add column if not exists file_alerts boolean not null default false;

create table if not exists public.file_grants (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  note           text check (note is null or length(note) <= 300),
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  expires_at     timestamptz
);
create index if not exists file_grants_lookup on public.file_grants (org_id, requirement_id, user_id, status);
create unique index if not exists file_grants_one_pending on public.file_grants (requirement_id, user_id) where status = 'pending';
alter table public.file_grants enable row level security;
create policy file_grants_read on public.file_grants for select to authenticated
  using (user_id = (select auth.uid()) or org_id in (select private.my_admin_org_ids()));
revoke insert, update, delete on public.file_grants from anon, authenticated;

create table if not exists public.file_opens (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references public.orgs(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  requirement_id uuid,
  file_name      text,
  storage_path   text not null,
  opened_at      timestamptz not null default now()
);
create index if not exists file_opens_org on public.file_opens (org_id, opened_at desc);
alter table public.file_opens enable row level security;
create policy file_opens_read on public.file_opens for select to authenticated using (org_id in (select private.my_admin_org_ids()));
revoke insert, update, delete on public.file_opens from anon, authenticated;

-- May the signed-in user open this stored file? Files that aren't permit documents (payment screenshots, bills)
-- follow the usual workspace rule.
create or replace function private.may_open_doc(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.documents d where d.storage_path = p_name)
    or exists (
      select 1 from public.documents d
      join public.orgs o on o.id = d.org_id
      join public.org_members m on m.org_id = d.org_id and m.user_id = (select auth.uid())
      where d.storage_path = p_name
        and (o.file_mode = 'open' or m.role in ('owner', 'admin')
          or exists (select 1 from public.file_grants g where g.org_id = d.org_id and g.requirement_id = d.requirement_id
                     and g.user_id = (select auth.uid()) and g.status = 'approved' and g.expires_at > now())))
$$;
revoke all on function private.may_open_doc(text) from public;
grant execute on function private.may_open_doc(text) to authenticated;

alter policy "documents: members can read" on storage.objects
  using (bucket_id = 'documents' and (storage.foldername(name))[1] in (select o::text from private.my_org_ids() o)
    and private.may_open_doc(name));

-- ======================================================================== what the app asks
create or replace function public.file_access_state(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_admin boolean; o public.orgs;
begin
  select m.role into v_role from public.org_members m where m.org_id = p_org and m.user_id = auth.uid() and p_org in (select private.my_org_ids());
  if v_role is null then raise exception 'Workspace not found.' using errcode = '42501'; end if;
  select * into o from public.orgs where id = p_org;
  v_admin := v_role in ('owner', 'admin');
  return jsonb_build_object('mode', o.file_mode, 'alerts', o.file_alerts, 'role', v_role,
    'mine', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'requirement_id', g.requirement_id, 'status', g.status, 'expires_at', g.expires_at) order by g.requested_at desc)
      from public.file_grants g where g.org_id = p_org and g.user_id = auth.uid() and (g.status = 'pending' or g.expires_at > now() or g.decided_at > now() - interval '1 day')), '[]'::jsonb),
    'pending', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'requirement_id', g.requirement_id, 'permit', r.name, 'note', g.note,
        'who', coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email), 'requested_at', g.requested_at) order by g.requested_at)
      from public.file_grants g join public.requirements r on r.id = g.requirement_id left join public.profiles p on p.id = g.user_id
      where g.org_id = p_org and g.status = 'pending'), '[]'::jsonb) else '[]'::jsonb end,
    'opens', case when v_admin then coalesce((select jsonb_agg(x order by x ->> 'opened_at' desc) from (
        select jsonb_build_object('file_name', f.file_name, 'requirement_id', f.requirement_id, 'opened_at', f.opened_at,
          'who', coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email, 'Someone no longer on the team')) x
        from public.file_opens f left join public.profiles p on p.id = f.user_id
        where f.org_id = p_org order by f.opened_at desc limit 60) s), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.set_file_mode(p_org uuid, p_mode text, p_alerts boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'owner')
     or p_org not in (select private.my_org_ids()) then
    raise exception 'Only the workspace owner can change who opens files.' using errcode = '42501';
  end if;
  if p_mode not in ('open', 'ask') then raise exception 'Choose who can open files.' using errcode = '22023'; end if;
  update public.orgs set file_mode = p_mode, file_alerts = coalesce(p_alerts, false) where id = p_org;
end $$;

create or replace function public.request_file_access(p_requirement uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.requirements; o public.orgs; v_role text; v_id uuid; v_who text;
begin
  select * into r from public.requirements where id = p_requirement and deleted_at is null;
  if r.id is null or r.org_id not in (select private.my_org_ids()) then raise exception 'Permit not found.' using errcode = '42501'; end if;
  select * into o from public.orgs where id = r.org_id;
  select role into v_role from public.org_members where org_id = r.org_id and user_id = auth.uid();
  if o.file_mode = 'open' or v_role in ('owner', 'admin') then raise exception 'You can already open these files.' using errcode = 'P0001'; end if;
  select id into v_id from public.file_grants where requirement_id = p_requirement and user_id = auth.uid() and status = 'pending';
  if v_id is null then
    insert into public.file_grants (org_id, requirement_id, user_id, note) values (r.org_id, p_requirement, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  end if;
  select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email) into v_who from public.profiles where id = auth.uid();
  insert into public.notifications (user_id, org_id, kind, title, body, link, requirement_id, dedupe_key)
  select m.user_id, r.org_id, 'team', v_who || ' asked to open the files of ' || r.name, nullif(btrim(coalesce(p_note, '')), ''),
    '#/settings/workspace?files=1', r.id, 'fileask:' || v_id || ':' || m.user_id
  from public.org_members m where m.org_id = r.org_id and m.role in ('owner', 'admin')
  on conflict (dedupe_key) do nothing;
  return v_id;
end $$;

create or replace function public.decide_file_access(p_grant uuid, p_allow boolean, p_hours int default 24) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.file_grants; v_name text;
begin
  select * into g from public.file_grants where id = p_grant;
  if g.id is null or g.org_id not in (select private.my_admin_org_ids()) then raise exception 'Only the owner or an admin can decide this.' using errcode = '42501'; end if;
  if g.status <> 'pending' then raise exception 'This request was already answered.' using errcode = 'P0001'; end if;
  if p_allow and coalesce(p_hours, 24) not in (24, 168) then raise exception 'Allow for 24 hours or 7 days.' using errcode = '22023'; end if;
  update public.file_grants set status = case when p_allow then 'approved' else 'denied' end, decided_by = auth.uid(), decided_at = now(),
    expires_at = case when p_allow then now() + make_interval(hours => coalesce(p_hours, 24)) end
  where id = p_grant;
  select name into v_name from public.requirements where id = g.requirement_id;
  insert into public.notifications (user_id, org_id, kind, title, link, requirement_id, dedupe_key)
  values (g.user_id, g.org_id, 'team', case when p_allow then 'You can open the files of ' || v_name || (case when p_hours = 168 then ' for 7 days' else ' for 24 hours' end)
      else 'Your request to open the files of ' || v_name || ' was declined' end, '#/requirement/' || g.requirement_id, g.requirement_id, 'filedecide:' || g.id)
  on conflict (dedupe_key) do nothing;
end $$;

-- Called by the document vault each time it hands someone a file (with that person's login), and by the app when
-- the vault is off. Only files the caller may open are recorded; anything else is ignored.
create or replace function public.log_file_open(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.documents; o public.orgs; v_role text; v_who text; v_name text;
begin
  select * into d from public.documents where storage_path = p_path;
  if d.id is null or d.org_id not in (select private.my_org_ids()) or not private.may_open_doc(p_path) then return; end if;
  insert into public.file_opens (org_id, user_id, requirement_id, file_name, storage_path) values (d.org_id, auth.uid(), d.requirement_id, d.file_name, p_path);
  select * into o from public.orgs where id = d.org_id;
  select role into v_role from public.org_members where org_id = d.org_id and user_id = auth.uid();
  if o.file_alerts and v_role <> 'owner' then
    select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email) into v_who from public.profiles where id = auth.uid();
    select name into v_name from public.requirements where id = d.requirement_id;
    insert into public.notifications (user_id, org_id, kind, title, body, link, requirement_id, dedupe_key)
    select m.user_id, d.org_id, 'team', v_who || ' opened a file of ' || coalesce(v_name, 'a permit'), d.file_name, '#/settings/workspace?files=1', d.requirement_id,
      'fileopen:' || auth.uid() || ':' || d.requirement_id || ':' || to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD')
    from public.org_members m where m.org_id = d.org_id and m.role = 'owner'
    on conflict (dedupe_key) do nothing;
  end if;
end $$;

revoke all on function public.file_access_state(uuid), public.set_file_mode(uuid, text, boolean), public.request_file_access(uuid, text),
  public.decide_file_access(uuid, boolean, int), public.log_file_open(text) from public, anon;
grant execute on function public.file_access_state(uuid), public.set_file_mode(uuid, text, boolean), public.request_file_access(uuid, text),
  public.decide_file_access(uuid, boolean, int), public.log_file_open(text) to authenticated;

insert into private.features (name) values ('fileguard') on conflict do nothing;
