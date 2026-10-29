-- Database file 21: each person's site theme (Signature navy and gold, Clean white, Mint garden, Forest and cream,
-- Sand and terracotta), saved with their profile so it follows them to every device.
alter table public.profiles add column if not exists theme text not null default 'signature'
  check (theme in ('signature', 'white', 'mint', 'forest', 'sand'));
grant update (theme) on public.profiles to authenticated;
insert into private.features (name) values ('themes') on conflict do nothing;
