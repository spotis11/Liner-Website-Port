/**
 * Task 35 proof harness for the resilient db layer.
 *
 * Modes (run with bun):
 *   seed    — fresh scratch db: DDL provisions tables, one ban is created,
 *             the bans mirror is written.
 *   verify  — after the scratch db FILE has been deleted: boot again, ensure
 *             the tables self-heal and the ban comes back from the mirror.
 *   real    — against the live database (read-only + IF NOT EXISTS no-ops):
 *             print ban count and table list.
 *
 * The scratch database lives in scripts/task35-scratch/ so the real mirror
 * at db/bans-mirror.json is never touched.
 */

const SCRATCH_DIR = "/home/z/my-project/scripts/task35-scratch";
const SCRATCH_DB = "file:/home/z/my-project/scripts/task35-scratch/custom-proof.db";
const mode = process.argv[2] ?? "verify";

if (mode === "seed") {
  process.env.DATABASE_URL = SCRATCH_DB;
  const { db, ensureDbReady, refreshBansMirror } = await import("../src/lib/db");
  // Same pattern the moderation lib uses before every db touch.
  await ensureDbReady();
  await db.ban.create({
    data: {
      username: "proofuser",
      type: "normal",
      reason: "task35 proof ban",
      createdBy: "jayzeyluna",
    },
  });
  await db.banIp.create({ data: { ip: "203.0.113.7", username: "proofuser" } });
  await refreshBansMirror();
  const n = await db.ban.count();
  console.log(`SEED ok: ${n} ban(s) in scratch db, mirror written`);
  process.exit(0);
}

if (mode === "verify") {
  process.env.DATABASE_URL = SCRATCH_DB;
  const { db, ensureDbReady } = await import("../src/lib/db");
  const ok = await ensureDbReady();
  const bans = await db.ban.findMany();
  const ips = await db.banIp.findMany();
  console.log(
    `VERIFY ok=${ok}: bans=${bans.map((b) => `${b.username}/${b.type}`).join(",")} ips=${ips.map((i) => i.ip).join(",")}`,
  );
  if (!ok || bans.length !== 1 || bans[0].username !== "proofuser" || ips.length !== 1) {
    console.error("FAIL: mirror restore did not rebuild the expected state");
    process.exit(1);
  }
  console.log("VERIFY PASS: wiped db self-healed + ban restored from mirror");
  process.exit(0);
}

if (mode === "real") {
  const { db, ensureDbReady } = await import("../src/lib/db");
  const ok = await ensureDbReady();
  const n = await db.ban.count();
  const tables = (await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  )) as { name: string }[];
  console.log(
    `REAL ok=${ok} bans=${n} tables=${tables.map((t) => t.name).join(",")}`,
  );
  process.exit(0);
}

console.error("unknown mode");
process.exit(1);
