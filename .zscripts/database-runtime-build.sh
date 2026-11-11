#!/bin/bash

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project}"
BUILD_DIR="${BUILD_DIR:?BUILD_DIR is required}"
SOURCE_DB_DIR="$PROJECT_DIR/db"
SOURCE_DB_PATH="$SOURCE_DB_DIR/custom.db"
TARGET_DB_DIR="$BUILD_DIR/db"

mkdir -p "$TARGET_DB_DIR"

# The platform unpacks this package OVER the previous container state.
# Shipping db/custom.db used to clobber the live database with this
# workspace's stale copy on EVERY republish — every Session row died (all
# users signed out), guest accounts and their libraries vanished.
#
# The package therefore carries NO database file. The FC container's live
# db/custom.db simply survives from deploy to deploy. For a brand-new
# container (no db at all) the package carries db/db-mirror-seed.json —
# the runtime's ensureDbReady() provisions the schema via its DDL
# self-healing, then restores accounts/sessions/library from the seed
# mirror (see restoreDbFromMirror in src/lib/db.ts).

SEED_PATH="$TARGET_DB_DIR/db-mirror-seed.json"
# Persistent cache of the last SUCCESSFUL production export. Lives in the
# workspace (gitignored), survives across builds. It is the primary fallback
# source when the live fetch fails: a slightly stale production snapshot is
# ALWAYS safer than the workspace's own db state, which local/E2E testing
# pollutes with test accounts — shipping that state to production once wiped
# real user accounts and echoed e2e_* test accounts into the live seed chain.
CACHE_PATH="${DB_MIRROR_CACHE_PATH:-$SOURCE_DB_DIR/production-mirror-latest.json}"

# --- NEW: prefer the LIVE production state over any local copy --------------
# Every deploy can recreate the FC container; the workspace database has
# never seen the accounts users created on production, so seeding from it
# signed everyone out on each republish. The running production server can
# export its live state via GET /api/db-mirror/latest (locked behind
# DB_MIRROR_EXPORT_KEY in the shared gitignored .env). Fetching it here makes
# the package restore exactly what production had at build time.
MIRROR_URL="${DB_MIRROR_SOURCE_URL:-https://liner-music.space-z.ai/api/db-mirror/latest}"
# Key precedence: explicit env override (E2E / alternate servers) first, then
# the shared gitignored .env that workspace builds and production both read.
MIRROR_KEY="${DB_MIRROR_EXPORT_KEY:-$(grep -E '^DB_MIRROR_EXPORT_KEY=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d ' ' || true)}"

validate_mirror() {
    python3 - "$1" << 'PYEOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    tables = data.get("tables")
    saved = data.get("savedAt")
    if not isinstance(tables, dict) or not isinstance(saved, str):
        raise ValueError("bad shape")
    accounts = len(tables.get("account") or [])
    keys = len(tables.get("systemKey") or [])
    if accounts == 0 and keys == 0:
        raise ValueError("mirror carries neither accounts nor system keys")
    print(f"OK accounts={accounts} systemKeys={keys} savedAt={saved}")
except Exception as exc:
    print(f"BAD {exc}")
PYEOF
}

fetch_mirror() {
    # $1 = full URL, $2 = transport label (for the log)
    curl -fsS -m 30 \
        -H "x-db-mirror-key: $MIRROR_KEY" \
        -H "authorization: Bearer $MIRROR_KEY" \
        "$1" -o "$SEED_PATH.tmp" 2>/dev/null
}

FETCHED=0
if [ -n "$MIRROR_KEY" ]; then
    echo "🗄️  Fetching the live production database mirror from $MIRROR_URL ..."
    CURL_RC=0
    fetch_mirror "$MIRROR_URL" || CURL_RC=$?
    SUMMARY="$(validate_mirror "$SEED_PATH.tmp" || true)"

    # Transport fallback: the platform gateway strips non-standard headers,
    # so a 403 (bad/empty key) retries once via the ?exportKey= param.
    if [[ "$SUMMARY" != OK* ]]; then
        [ -n "$SUMMARY" ] && echo "↪️  headers attempt failed ($SUMMARY) — retrying via the exportKey parameter"
        rm -f "$SEED_PATH.tmp"
        CURL_RC=0
        fetch_mirror "$MIRROR_URL?exportKey=$MIRROR_KEY" || CURL_RC=$?
        SUMMARY="$(validate_mirror "$SEED_PATH.tmp" || true)"
    fi

    if [[ "$SUMMARY" == OK* ]]; then
        mv "$SEED_PATH.tmp" "$SEED_PATH"
        echo "✅ $SUMMARY"
        echo "   → package will restore the LIVE production state (accounts/sessions survive the deploy)"
        FETCHED=1
        # Persist this export as the emergency fallback for future builds.
        if cp "$SEED_PATH" "$CACHE_PATH.tmp" 2>/dev/null && mv "$CACHE_PATH.tmp" "$CACHE_PATH"; then
            echo "💾 cached production export for future fallback: $CACHE_PATH"
        else
            echo "⚠️  could not write the production mirror cache (non-fatal)"
        fi
    else
        echo "⚠️  fetched mirror invalid ($SUMMARY)"
        rm -f "$SEED_PATH.tmp"
    fi
else
    echo "ℹ️  DB_MIRROR_EXPORT_KEY not set in .env — production mirror fetch skipped"
fi

# --- Fallback chain (only reached when the live fetch did not happen) -------
# Order matters and is deliberate:
#   1. cached production export — the last state production is KNOWN to have
#      had; at worst it loses accounts created since that export.
#   2. workspace runtime mirror — last resort. DANGER: this file tracks the
#      workspace's own db, which local/E2E testing pollutes with test
#      accounts. Shipping it to production has historically wiped real user
#      accounts; expect a loud warning here instead of a silent pass.
if [ "$FETCHED" = "0" ]; then
    if [ -f "$CACHE_PATH" ]; then
        CACHE_SUMMARY="$(validate_mirror "$CACHE_PATH" || true)"
        if [[ "$CACHE_SUMMARY" == OK* ]]; then
            cp "$CACHE_PATH" "$SEED_PATH"
            echo "🛟  LIVE FETCH UNAVAILABLE — using the cached production export ($CACHE_SUMMARY)"
            echo "    Accounts created on production AFTER this export will NOT be in the package."
            FETCHED=1
        else
            echo "⚠️  cached production export is invalid ($CACHE_SUMMARY) — ignoring it"
        fi
    fi
fi

if [ "$FETCHED" = "0" ]; then
    if [ -f "$SOURCE_DB_DIR/db-mirror.json" ]; then
        echo "🚨  FALLING BACK TO THE WORKSPACE MIRROR ($SOURCE_DB_DIR/db-mirror.json)"
        echo "    This file reflects the LOCAL workspace db, not production. If local"
        echo "    or E2E testing ran against :3000, its test accounts ship to"
        echo "    production with this package. Prefer fixing the live fetch first!"
        cp "$SOURCE_DB_DIR/db-mirror.json" "$SEED_PATH"
    else
        echo "🗄️  Generating the package mirror from the workspace database..."
        (
            cd "$PROJECT_DIR"
            DATABASE_URL="file:$SOURCE_DB_PATH" \
                node scripts/gen_db_mirror_seed.mjs --out "$SEED_PATH"
        )
    fi
fi

if [ ! -s "$SEED_PATH" ]; then
    echo "❌ database seed mirror missing or empty: $SEED_PATH"
    exit 1
fi

echo "✅ 构建产物数据库策略：不携带 custom.db（保护线上库），携带 db-mirror-seed.json"
ls -lah "$TARGET_DB_DIR"
