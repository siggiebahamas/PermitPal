#!/bin/bash
# Starts a throwaway Postgres 16 for the SQL tests (socket /tmp, port 54329). Run as root in a dev container.
set -e
D=/tmp/ppdb/data; BIN=$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || true)
[ -n "$BIN" ] || { echo "Install Postgres 16 first (apt-get install -y postgresql-16)"; exit 1; }
mkdir -p /tmp/ppdb && chown postgres /tmp/ppdb
[ -d $D ] || su postgres -c "$BIN/initdb -D $D -A trust -U postgres" >/dev/null
pg_isready -h /tmp -p 54329 >/dev/null 2>&1 || su postgres -c "$BIN/pg_ctl -D $D -o '-p 54329 -k /tmp' -l /tmp/ppdb/log start" >/dev/null
pg_isready -h /tmp -p 54329
