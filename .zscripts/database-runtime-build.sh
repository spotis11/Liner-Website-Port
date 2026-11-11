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

if [ -f "$SOURCE_DB_DIR/db-mirror.json" ]; then
    echo "🗄️  Seeding the package mirror from the live runtime mirror (db/db-mirror.json)..."
    cp "$SOURCE_DB_DIR/db-mirror.json" "$SEED_PATH"
else
    echo "🗄️  Generating the package mirror from the workspace database..."
    (
        cd "$PROJECT_DIR"
        DATABASE_URL="file:$SOURCE_DB_PATH" \
            node scripts/gen_db_mirror_seed.mjs --out "$SEED_PATH"
    )
fi

if [ ! -s "$SEED_PATH" ]; then
    echo "❌ database seed mirror missing or empty: $SEED_PATH"
    exit 1
fi

echo "✅ 构建产物数据库策略：不携带 custom.db（保护线上库），携带 db-mirror-seed.json"
ls -lah "$TARGET_DB_DIR"
