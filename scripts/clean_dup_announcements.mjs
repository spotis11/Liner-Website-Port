// One-off cleanup: the bot briefly ran 4 duplicate instances and posted the
// same commit embeds repeatedly. Keeps the newest embed per title in the
// git-logs channel and deletes the older duplicates. Token comes from
// liner-bot/.env and is never printed.
import fs from "node:fs";
import path from "node:path";

const BOT_DIR = "/home/z/my-project/liner-bot";
const CHANNEL_ID = process.env.CHANNEL_ID || "1570718488283324417";

const env = fs.readFileSync(path.join(BOT_DIR, ".env"), "utf8");
const TOKEN = env.match(/^DISCORD_BOT_TOKEN=(.*)$/m)?.[1]?.trim();
if (!TOKEN) {
  console.error("no token in liner-bot/.env");
  process.exit(1);
}

const API = "https://discord.com/api/v10";
const headers = { Authorization: `Bot ${TOKEN}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(`${API}/channels/${CHANNEL_ID}/messages?limit=50`, { headers });
if (!res.ok) {
  console.error("fetch messages failed:", res.status);
  process.exit(1);
}
const messages = await res.json();

// keep the newest message per embed title, delete older duplicates
const seen = new Set();
const toDelete = [];
for (const m of messages) {
  const title = m.embeds?.[0]?.title || null;
  if (!title) continue; // non-embed messages left alone
  if (seen.has(title)) toDelete.push(m);
  else seen.add(title);
}

console.log(`messages scanned: ${messages.length}, duplicates to delete: ${toDelete.length}`);
for (const m of toDelete) {
  const del = await fetch(`${API}/channels/${CHANNEL_ID}/messages/${m.id}`, {
    method: "DELETE",
    headers,
  });
  console.log(`delete ${m.id} "${m.embeds?.[0]?.title}": ${del.status === 204 ? "OK" : del.status}`);
  await sleep(400);
}
console.log("done");
