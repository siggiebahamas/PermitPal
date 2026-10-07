-- "Contact PermitPal": the one way customers (and people without an account, e.g. staff whose
-- licence details an employer added) reach the PermitPal team and its Data Protection Officer.
-- Messages are stored for the admin inbox and emailed to the admin address(es).
create table public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  org_id      uuid references public.orgs(id) on delete set null,
  name        text not null default '' check (length(name) <= 120),
  email       text not null check (length(email) between 3 and 200),
  topic       text not null default 'question' check (topic in ('question','problem','billing','privacy','other')),
  message     text not null check (length(btrim(message)) between 1 and 4000),
  status      text not null default 'open' check (status in ('open','closed')),
  created_at  timestamptz not null default now()
);
create index support_messages_open_idx on public.support_messages (created_at desc);
alter table public.support_messages enable row level security;
create policy support_messages_read on public.support_messages for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));
create policy support_messages_staff_update on public.support_messages for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke all on public.support_messages from anon;
revoke insert, delete on public.support_messages from authenticated;

create or replace function public.contact_support(p_topic text, p_message text, p_name text default null, p_email text default null, p_org uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text; v_name text; v_org uuid; v_org_name text; v_id uuid;
  v_topic text := coalesce(nullif(p_topic, ''), 'question');
  v_labels jsonb := '{"question":"Question","problem":"Something is not working","billing":"Plans & payment","privacy":"Privacy / my data","other":"Other"}';
begin
  if nullif(btrim(coalesce(p_message, '')), '') is null then raise exception 'Please write a message.'; end if;
  if length(p_message) > 4000 then raise exception 'Please keep the message under 4,000 characters.'; end if;
  if not (v_labels ? v_topic) then v_topic := 'other'; end if;
  if v_uid is not null then
    select u.email into v_email from auth.users u where u.id = v_uid;
    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') into v_name from public.profiles p where p.id = v_uid;
    if p_org is not null and p_org in (select private.my_org_ids()) then
      v_org := p_org; select o.name into v_org_name from public.orgs o where o.id = p_org;
    end if;
    if (select count(*) from public.support_messages where user_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
      raise exception 'You have sent several messages in the last hour. We will reply to those first.';
    end if;
  else
    v_email := lower(btrim(coalesce(p_email, '')));
    v_name := nullif(btrim(coalesce(p_name, '')), '');
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address so we can reply.'; end if;
    if (select count(*) from public.support_messages where user_id is null and lower(email) = v_email and created_at > now() - interval '1 hour') >= 3
       or (select count(*) from public.support_messages where user_id is null and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'Too many messages right now. Please try again in an hour.';
    end if;
  end if;
  insert into public.support_messages (user_id, org_id, name, email, topic, message)
  values (v_uid, v_org, left(coalesce(v_name, ''), 120), left(v_email, 200), v_topic, btrim(p_message))
  returning id into v_id;
  perform private.notify_admins(
    'Contact form: ' || (v_labels ->> v_topic),
    'From ' || coalesce(v_name || ' ', '') || '<' || v_email || '>' || coalesce(' · ' || v_org_name, '')
      || case when v_uid is null then ' (no account)' else '' end || E'.\nReply to them at ' || v_email || E'.\n\n' || btrim(p_message),
    'support:' || v_id, true);
  return v_id;
end $$;
revoke all on function public.contact_support(text, text, text, text, uuid) from public;
grant execute on function public.contact_support(text, text, text, text, uuid) to anon, authenticated;
