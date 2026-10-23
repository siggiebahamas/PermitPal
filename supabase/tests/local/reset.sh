#!/bin/bash
# A fresh local Postgres 16 database with every migration, for the SQL tests in supabase/tests/.
# Usage: bash supabase/tests/local/reset.sh [dbname]   (default pplocal)
# Needs a running Postgres 16 on socket /tmp, port 54329 (see start.sh).
set -e
DB=${1:-pplocal}; HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd); TMP=$(mktemp -d)
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
for r in anon authenticated service_role; do $P -d postgres -c "do \$\$ begin create role $r nologin noinherit; exception when duplicate_object then null; end \$\$" >/dev/null; done
$P -d postgres -c "do \$\$ begin create role authenticator login noinherit; exception when duplicate_object then null; end \$\$; grant anon, authenticated, service_role to authenticator;" >/dev/null 2>&1
$P -d postgres -c "alter role service_role bypassrls" >/dev/null
$P -d postgres -c "do \$\$ begin create role supabase_admin superuser; exception when duplicate_object then null; end \$\$" >/dev/null
sed -e '/^create role/d' -e "s/alter database postgres/alter database $DB/" "$HERE/shim.sql" > "$TMP/shim.sql"
$P -d $DB -f "$TMP/shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  grep -v -i -E "^create extension if not exists (pg_net|pg_cron)" "$f" > "$TMP/cur.sql"
  $P -d $DB -f "$TMP/cur.sql" > "$TMP/mig.log" 2>&1 || { echo "FAILED: $f"; tail -5 "$TMP/mig.log"; exit 1; }
done
echo "ok: $DB"
