-- Pinoy Permit (was PermitPal): every email, notice, error message and service description the database writes now
-- says "Pinoy Permit". Customers' own records, history and messages already sent are not touched.
-- All or nothing: if anything fails, nothing is changed.
--
-- Order matters: run 2026-10-28-packets-and-city-dates.sql first, then this file, once.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'packet'), exists (select 1 from private.features where name = 'pinoypermit')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-10-28-packets-and-city-dates.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261029001000_pinoy_permit.sql
-- PermitPal is now Pinoy Permit. Every email, notice, error message and service description the database writes
-- says "Pinoy Permit". Function bodies are rewritten in place (same signature, owner, security and grants), so no
-- behavior changes. Web addresses (/PermitPal/ on GitHub Pages) and stored values such as bill mode 'permitpal'
-- stay as they are. Customers' own records, history and messages already sent are not touched.
do $$ declare f record; v_def text; v_new text; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and p.prokind in ('f', 'p') and p.prosrc like '%PermitPal%' loop
    v_def := pg_get_functiondef(f.oid);
    -- the two-color name at the top of every email
    v_new := replace(v_def, '<span style="color:#0C2A57">Permit</span><span style="color:#2F6FED">Pal</span>',
      '<span style="color:#0C2A57">Pinoy</span> <span style="color:#2F6FED">Permit</span>');
    v_new := regexp_replace(v_new, '(^|[^/A-Za-z])PermitPal', '\1Pinoy Permit', 'g');
    if v_new <> v_def then execute v_new; end if;
  end loop;
end $$;

-- Text PermitPal wrote itself: service descriptions, plans, add-ons, load products, templates and the like.
do $$ declare c record; begin
  for c in select table_schema s, table_name t, column_name col, data_type dt from information_schema.columns
           where table_schema = 'public' and udt_name in ('text', 'varchar', '_text', 'jsonb')
             and table_name in ('services', 'plans', 'care_tiers', 'addons', 'load_products', 'doc_templates', 'requirement_types',
                                'filing_types', 'city_rules', 'app_settings') loop
    execute format('update %I.%I set %I = regexp_replace(%I::text, %L, %L, %L)::%s where %I::text ~ %L',
      c.s, c.t, c.col, c.col, '(^|[^/A-Za-z])PermitPal', '\1Pinoy Permit', 'g',
      case c.dt when 'ARRAY' then 'text[]' when 'jsonb' then 'jsonb' else 'text' end, c.col, '(^|[^/A-Za-z])PermitPal');
  end loop;
end $$;

insert into private.features (name) values ('pinoypermit') on conflict do nothing;

commit;
