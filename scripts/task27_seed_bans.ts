/**
 * Task 27 E2E helper — seed/clear test ban rows directly in SQLite so the
 * enforcement matrix can be verified without real admin credentials (the
 * admin API gate is upstream-verified and must stay closed in tests).
 *
 * Usage: bun scripts/task27_seed_bans.ts <seed|clear>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const mode = process.argv[2] ?? "seed";

async function main() {
  if (mode === "clear") {
    await prisma.ban.deleteMany({ where: { username: { startsWith: "e2e" } } });
    await prisma.banIp.deleteMany({ where: { username: { startsWith: "e2e" } } });
    await prisma.ipSeen.deleteMany({ where: { username: { startsWith: "e2e" } } });
    console.log("cleared");
    return;
  }

  // account ban, forever
  await prisma.ban.upsert({
    where: { username: "e2ebanned" },
    create: {
      username: "e2ebanned",
      type: "normal",
      reason: "e2e test ban",
      createdBy: "jayzeyluna",
      expiresAt: null,
    },
    update: { type: "normal", reason: "e2e test ban", expiresAt: null },
  });

  // ip ban with one frozen address, expires in 1h
  await prisma.ban.upsert({
    where: { username: "e2eipban" },
    create: {
      username: "e2eipban",
      type: "ip",
      reason: "e2e ip ban",
      createdBy: "jayzeyluna",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    update: { type: "ip", reason: "e2e ip ban", expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await prisma.banIp.upsert({
    where: { ip: "203.0.113.77" },
    create: { ip: "203.0.113.77", username: "e2eipban" },
    update: { username: "e2eipban" },
  });

  // expired ban — must be pruned on the next check
  await prisma.ban.upsert({
    where: { username: "e2eexpired" },
    create: {
      username: "e2eexpired",
      type: "normal",
      reason: "e2e expired",
      createdBy: "jayzeyluna",
      expiresAt: new Date(Date.now() - 1_000),
    },
    update: { type: "normal", reason: "e2e expired", expiresAt: new Date(Date.now() - 1_000) },
  });

  console.log("seeded");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
