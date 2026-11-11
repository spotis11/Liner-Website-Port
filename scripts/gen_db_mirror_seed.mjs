// Dump the workspace database into a JSON mirror file (deploy seed).
//
// The deploy package must NOT carry db/custom.db — it would clobber the live
// FC database on every republish and sign every user out. It carries
// db-mirror-seed.json instead, restored by the runtime ONLY when the
// database comes up fresh (brand-new container).
//
// JSON shape matches restoreDbFromMirror() in src/lib/db.ts:
//   { savedAt: string, tables: { [prismaModel]: rows[] } }
// Keep TABLES in sync with MIRROR_TABLES in src/lib/db.ts.
//
// Usage: DATABASE_URL="file:/home/z/my-project/db/custom.db" \
//        node scripts/gen_db_mirror_seed.mjs --out <path>
import { writeFileSync, renameSync } from "node:fs";

const TABLES = [
  "account",
  "session",
  "playlist",
  "playlistTrack",
  "likedTrack",
  "playHistory",
  "announcement",
  "ban",
  "ipSeen",
  "banIp",
  "userSeen",
  "systemKey",
  "emailLog",
  "accountTrack",
  "accountPlaylist",
  "accountPlaylistItem",
];

const argOut = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 ? process.argv[i + 1] : null;
})();
if (!argOut) {
  console.error("usage: node gen_db_mirror_seed.mjs --out <path>");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

const tables = {};
let total = 0;
try {
  for (const name of TABLES) {
    const delegate = db[name];
    if (!delegate?.findMany) {
      tables[name] = [];
      continue;
    }
    const rows = await delegate.findMany();
    tables[name] = rows;
    total += rows.length;
  }
} finally {
  await db.$disconnect();
}

const mirror = { savedAt: new Date().toISOString(), tables };
const tmp = `${argOut}.tmp`;
writeFileSync(tmp, JSON.stringify(mirror, null, 1), "utf8");
renameSync(tmp, argOut);
console.log(`database seed mirror written: ${argOut} (${total} rows)`);
