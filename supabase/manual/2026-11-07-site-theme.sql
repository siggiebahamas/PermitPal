-- Database file 21 (site themes). Run once, in the Supabase SQL Editor, after file 20.
-- Each person's site theme (Signature navy and gold, Clean white, Mint garden, Forest and cream, Sand and
-- terracotta) is saved with their profile so it follows them to every device.
-- All or nothing: if anything fails, nothing is changed.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'fileguard'), exists (select 1 from private.features where name = 'themes')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-11-06-file-access.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

alter table public.profiles add column if not exists theme text not null default 'signature'
  check (theme in ('signature', 'white', 'mint', 'forest', 'sand'));
grant update (theme) on public.profiles to authenticated;
insert into private.features (name) values ('themes') on conflict do nothing;

commit;
