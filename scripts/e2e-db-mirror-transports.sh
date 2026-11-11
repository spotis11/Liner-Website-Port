#!/bin/bash
# E2E: /api/db-mirror/latest must accept the export key through every
# transport, because the platform gateway strips non-standard headers.
# v1.14.2 regression test for the "logged out + create an account on every
# deploy" bug: the build fetch got 403 (stripped header) -> stale seed ->
# fresh container wiped user accounts.
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

KEY=$(grep -E '^DB_MIRROR_EXPORT_KEY=' .env | tail -1 | cut -d= -f2- | tr -d '"')
[ -n "$KEY" ] || { echo "no DB_MIRROR_EXPORT_KEY in .env"; exit 1; }

DIRECT=http://127.0.0.1:3000/api/db-mirror/latest
GATE=http://127.0.0.1:3200/api/db-mirror/latest

code() { curl -s -o /dev/null -w "%{http_code}" -m 10 "$@"; }

echo "=== transport matrix (direct + through header-stripping gateway) ==="
C=$(code -H "x-db-mirror-key: $KEY" "$DIRECT")
[ "$C" = 200 ] && ok "direct + x-db-mirror-key -> 200" || bad "direct + x-db-mirror-key -> $C (want 200)"
C=$(code -H "authorization: Bearer $KEY" "$DIRECT")
[ "$C" = 200 ] && ok "direct + authorization Bearer -> 200" || bad "direct + authorization Bearer -> $C (want 200)"
C=$(code "$DIRECT?exportKey=$KEY")
[ "$C" = 200 ] && ok "direct + ?exportKey -> 200" || bad "direct + ?exportKey -> $C (want 200)"
C=$(code -H "x-db-mirror-key: wrongkey-wrongkey-wrongkey-wrongkey-wrongkey-wrongkey-wrong" "$DIRECT")
[ "$C" = 403 ] && ok "direct + wrong key -> 403" || bad "direct + wrong key -> $C (want 403)"
C=$(code "$DIRECT")
[ "$C" = 403 ] && ok "direct + no key -> 403" || bad "direct + no key -> $C (want 403)"

C=$(code -H "x-db-mirror-key: $KEY" "$GATE")
[ "$C" = 403 ] && ok "gateway strips x-db-mirror-key -> 403 (reproduces the prod bug)" || bad "gateway + x-db-mirror-key -> $C (want 403, proving the strip)"
C=$(code -H "x-db-mirror-key: $KEY" -H "authorization: Bearer $KEY" "$GATE")
[ "$C" = 200 ] && ok "gateway + both headers -> 200 (authorization survives the strip)" || bad "gateway + both headers -> $C (want 200)"
C=$(code "$GATE?exportKey=$KEY")
[ "$C" = 200 ] && ok "gateway + ?exportKey -> 200 (param fallback works)" || bad "gateway + ?exportKey -> $C (want 200)"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
