-- PermitPal core: workspaces, members, profiles, plans, private settings.
--
-- Tenancy model: every piece of customer data belongs to a workspace ("org").
-- People join workspaces through org_members with a role:
--   owner  - everything, including billing and deleting the workspace
--   admin  - everything except billing / deleting the workspace
--   member - add and update businesses, vehicles, permits and documents
--   viewer - read only (e.g. an accountant)

create extension if not exists pgcrypto with schema extensions;

-- Functions and settings the browser must never call directly live here.
-- PostgREST only exposes "public", so nothing in "private" is reachable over the API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

create table private.settings (
  key   text primary key,
  value text not null
);
insert into private.settings (key, value) values
  ('app_url', 'https://siggiebahamas.github.io/PermitPal/'),
  ('functions_url', 'https://zeaiwvgktakbwnqpchbo.supabase.co/functions/v1'),
  ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex')),
  ('admin_notify_emails', ''),           -- comma separated; who receives new help requests
  ('channel_status', '{}')               -- which message channels the sender reports as connected
on conflict (key) do nothing;

create function private.setting(k text) returns text
language sql stable security definer set search_path = '' as $$
  select value from private.settings where key = k
$$;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- plans
create table public.plans (
  id                          text primary key,
  name                        text not null,
  price_php_monthly           numeric(10,2),   -- null = not on sale yet (checkout disabled)
  max_businesses              int,             -- null = unlimited
  max_vehicles                int,
  max_members                 int,
  max_locations_per_business  int,
  paid_channels               boolean not null default false,  -- SMS / WhatsApp reminders
  features                    text[] not null default '{}',
  sort                        int not null default 0
);
insert into public.plans (id, name, price_php_monthly, max_businesses, max_vehicles, max_members, max_locations_per_business, paid_channels, features, sort) values
  ('free', 'Free', 0, 1, 1, 1, 1, false,
     array['1 business and 1 vehicle','Compliance tracking and status','Document vault','Email and in-app reminders'], 1),
  ('business', 'Business', null, null, null, 5, 1, true,
     array['Unlimited businesses and vehicles','Up to 5 team members','SMS and WhatsApp reminders','Everything in Free'], 2),
  ('business_plus', 'Business Plus', null, null, null, 20, null, true,
     array['Multiple branches per business','Up to 20 team members','Everything in Business'], 3);

-- ---------------------------------------------------------------- orgs
create table public.orgs (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 1 and 120),
  plan_id          text not null default 'free' references public.plans(id),
  plan_expires_at  timestamptz,            -- null = does not lapse (free, or comped by PermitPal)
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,            -- deletion requested; data is purged at purge_after
  purge_after      timestamptz
);
create trigger orgs_touch before update on public.orgs for each row execute function private.touch_updated_at();

create table public.org_members (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members(user_id);

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  first_name         text not null default '' check (length(first_name) <= 80),
  last_name          text not null default '' check (length(last_name) <= 80),
  role_title         text not null default '' check (length(role_title) <= 80),
  phone              text check (phone is null or phone ~ '^\+[0-9]{8,15}$'),
  avatar_path        text,
  lang               text not null default 'en' check (lang in ('en','tl')),
  current_org_id     uuid references public.orgs(id) on delete set null,
  is_platform_admin  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();

create table public.notification_prefs (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  email_enabled    boolean not null default true,
  sms_enabled      boolean not null default false,
  whatsapp_enabled boolean not null default false,
  business_alerts  boolean not null default true,
  vehicle_alerts   boolean not null default true,
  remind_30        boolean not null default true,
  remind_7         boolean not null default true,
  remind_1         boolean not null default true,
  weekly_digest    boolean not null default true,
  updated_at       timestamptz not null default now()
);
create trigger notification_prefs_touch before update on public.notification_prefs for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- membership helpers (used by every RLS policy)
create function private.my_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m where m.user_id = (select auth.uid())
$$;
create function private.my_writable_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner','admin','member')
$$;
create function private.my_admin_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner','admin')
$$;
create function private.my_owner_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m
  where m.user_id = (select auth.uid()) and m.role = 'owner'
$$;
create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = (select auth.uid())), false)
$$;
create function private.member_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.org_members m where m.org_id = p_org and m.user_id = (select auth.uid())
$$;
-- The plan that actually applies right now: a lapsed paid plan falls back to Free.
create function private.effective_plan_id(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when o.plan_expires_at is not null and o.plan_expires_at < now() then 'free' else o.plan_id end
  from public.orgs o where o.id = p_org
$$;
grant execute on function private.my_org_ids(), private.my_writable_org_ids(), private.my_admin_org_ids(),
  private.my_owner_org_ids(), private.is_platform_admin(), private.member_role(uuid),
  private.effective_plan_id(uuid) to authenticated;

-- ---------------------------------------------------------------- new sign-ups
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (new.id, new.email,
          left(coalesce(new.raw_user_meta_data->>'first_name', ''), 80),
          left(coalesce(new.raw_user_meta_data->>'last_name', ''), 80))
  on conflict (id) do nothing;
  insert into public.notification_prefs (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- ---------------------------------------------------------------- row level security
alter table public.plans enable row level security;
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.profiles enable row level security;
alter table public.notification_prefs enable row level security;

create policy plans_read on public.plans for select to anon, authenticated using (true);

create policy orgs_read on public.orgs for select to authenticated
  using (id in (select private.my_org_ids()) or (select private.is_platform_admin()));
create policy orgs_rename on public.orgs for update to authenticated
  using (id in (select private.my_admin_org_ids()))
  with check (id in (select private.my_admin_org_ids()));

create policy members_read on public.org_members for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));

create policy profiles_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select m.user_id from public.org_members m where m.org_id in (select private.my_org_ids()))
    or (select private.is_platform_admin())
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy prefs_read on public.notification_prefs for select to authenticated
  using (user_id = (select auth.uid()));
create policy prefs_update on public.notification_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Column-level write access: people can rename a workspace but never touch its plan,
-- and can edit their own profile but never make themselves a platform admin.
revoke insert, update, delete on public.plans, public.orgs, public.org_members, public.profiles from anon, authenticated;
grant update (name) on public.orgs to authenticated;
grant update (first_name, last_name, role_title, phone, avatar_path, lang, current_org_id) on public.profiles to authenticated;
revoke all on public.orgs, public.org_members, public.profiles, public.notification_prefs from anon;

-- ---------------------------------------------------------------- workspace creation
create function public.create_org(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then raise exception 'Please sign in first.' using errcode = '28000'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Please enter a workspace name.' using errcode = '22023'; end if;
  if (select count(*) from public.org_members where user_id = v_uid and role = 'owner') >= 10 then
    raise exception 'You already own 10 workspaces. Contact support to add more.' using errcode = 'P0001';
  end if;
  insert into public.orgs (name, created_by) values (btrim(p_name), v_uid) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_uid, 'owner');
  update public.profiles set current_org_id = v_org where id = v_uid;
  return v_org;
end $$;
revoke execute on function public.create_org(text) from public, anon;
grant execute on function public.create_org(text) to authenticated;
