#!/bin/bash
# Runs SQL test files and prints "<file>: N ok" plus any failing check or error.
# Usage: bash supabase/tests/local/run.sh pplocal supabase/tests/06_*.sql ...   (tests 06 and up use this format)
DB=$1; shift
for f in "$@"; do out=$(psql -h /tmp -p 54329 -U postgres -d $DB -f $f 2>&1); bad=$(echo "$out" | grep -E "^\s+[0-9]+ \|.*\| f +\|" | head -5); err=$(echo "$out" | grep -E "ERROR" | head -3); n=$(echo "$out" | grep -cE "^\s+[0-9]+ \|.*\| t +\|"); echo "$(basename $f): $n ok ${bad:+FAIL: $bad} ${err:+ERR: $err}"; done
