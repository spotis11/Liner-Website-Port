#!/usr/bin/env python3
"""Make the platform's database-runtime-build.sh tolerant of db:push failure.

The deployed Next.js app self-heals its SQLite schema on boot (CREATE TABLE
IF NOT EXISTS DDL in src/lib/db.ts) and db/custom.db is committed to the
repo, so a failing `bun run db:push` in a cloud build sandbox must not abort
the whole deploy (set -e previously killed the build on this step).
"""
from pathlib import Path

TARGET = Path("/tmp/my-project/.zscripts/database-runtime-build.sh")

OLD = '''echo "🗄️  同步构建产物中的数据库结构..."
(
    cd "$PROJECT_DIR"
    DATABASE_URL="file:$TARGET_DB_PATH" bun run db:push
)'''
NEW = '''echo "🗄️  同步构建产物中的数据库结构..."
(
    cd "$PROJECT_DIR"
    # Non-fatal: the Next.js runtime self-heals the schema on boot (CREATE
    # TABLE IF NOT EXISTS DDL in src/lib/db.ts), and db/custom.db is now
    # committed to the repo so the packaged file exists regardless.
    DATABASE_URL="file:$TARGET_DB_PATH" bun run db:push \\
        || echo "⚠️  db:push failed (non-fatal) — runtime DDL self-healing will provision the schema"
)'''

src = TARGET.read_text()
if OLD in src:
    TARGET.write_text(src.replace(OLD, NEW))
    print("PATCHED", TARGET)
elif NEW in src:
    print("ALREADY-PATCHED")
else:
    raise SystemExit("PATTERN-NOT-FOUND — script changed upstream, inspect manually")
