-- Minimal stand-ins for what a Supabase project provides, so the PermitPal migrations and SQL tests run on plain Postgres.
create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;
create role supabase_admin superuser;
create schema extensions; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions;
alter database postgres set search_path = "$user", public, extensions;
set search_path = "$user", public, extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255), encrypted_password varchar(255),
  email_confirmed_at timestamptz, invited_at timestamptz, confirmation_token varchar(255), recovery_token varchar(255),
  last_sign_in_at timestamptz, raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  is_super_admin boolean, created_at timestamptz default now(), updated_at timestamptz default now(), phone text, phone_confirmed_at timestamptz,
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role') $$;
create function auth.email() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.email', true), current_setting('request.jwt.claims', true)::jsonb ->> 'email') $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage; grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null unique, owner uuid, public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid,
  owner_id text, metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored, version text,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now());
alter table storage.objects enable row level security; alter table storage.buckets enable row level security;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
grant execute on all functions in schema storage to anon, authenticated, service_role;
-- pg_cron / pg_net stand-ins: record calls instead of running them
create schema cron; create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.job where jobname = job_name returning true $$;
create schema net; create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb, at timestamptz default now());
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.calls (url, body, headers) values (url, body, headers) returning id $$;
grant usage on schema net, cron to service_role;
create publication supabase_realtime;

-- Supabase Auth MFA factors (stand-in)
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text, factor_type text not null default 'totp', status text not null default 'unverified', secret text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
