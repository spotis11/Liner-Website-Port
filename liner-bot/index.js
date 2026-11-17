// Liner System — private Discord bot of the official Liner Discord server.
//
// - 24/7 presence: custom status "liner-music.space-z.ai"
// - watches git commits on the Liner website repo (origin main) and posts an
//   embed styled after the original Liner System announcements:
//     [repo] N new commit(s)
//     `sha7` subject *author*
//     footer: GitHub • owner/repo • time ago   (+ Open on GitHub link button)
//   No reactions, no emoji characters — images/buttons only.
// - basic "." commands: .lock .unlock .ping .help .commits .commitchannel .status
//   moderation: .ban @user|userid[, reason] .timeout @user|userid[, duration reason]
//
// Token comes from liner-bot/.env (DISCORD_BOT_TOKEN) — never committed.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import {
  Client,
  Events,
  GatewayIntentBits,
  ActivityType,
  Partials,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from "discord.js";

const BOT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(BOT_DIR, "..");
const DATA_DIR = path.join(BOT_DIR, "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const STATUS_PATH = path.join(BOT_DIR, "bot_status.json");

// ---------- config (env overrides, sane defaults) ----------
function loadDotEnv() {
  const p = path.join(BOT_DIR, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnv();

const TOKEN = (process.env.DISCORD_BOT_TOKEN || "").trim();
const PRESENCE = process.env.BOT_PRESENCE || "liner-music.space-z.ai";
const REPO_DIR = process.env.WATCH_REPO_DIR || ROOT;
const REPO_REMOTE = process.env.WATCH_REMOTE || "origin";
const REPO_BRANCH = process.env.WATCH_BRANCH || "main";
const POLL_MS = Number(process.env.WATCH_POLL_MS || 60_000);
const THUMB =
  process.env.EMBED_THUMBNAIL_URL || "https://avatars.githubusercontent.com/u/244527415?v=4";
const FOOTER_ICON =
  process.env.EMBED_FOOTER_ICON_URL ||
  "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png";
const ANNOUNCE_CHANNEL_ID = (process.env.ANNOUNCE_CHANNEL_ID || "").trim();

if (!TOKEN) {
  console.error("[liner-bot] no DISCORD_BOT_TOKEN in liner-bot/.env — exiting for supervisor retry");
  process.exit(1);
}

// ---------- tiny state + status helpers ----------
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

const state = readJson(STATE_PATH, {});
state.lastAnnouncedSha ||= null;
state.commitchannelId ||= null;

const STATUS = {
  status: "starting",
  pid: process.pid,
  host: os.hostname().slice(0, 40),
  started_at: new Date().toISOString(),
  last_ready_at: null,
  bot_username: null,
  guild_count: 0,
  heartbeat: new Date().toISOString(),
  kind: "liner-system",
  watching: null,
  announce_channel: null,
};
function touchStatus(patch = {}) {
  Object.assign(STATUS, patch);
  STATUS.heartbeat = new Date().toISOString();
  try {
    writeJsonAtomic(STATUS_PATH, STATUS);
  } catch (e) {
    console.error("[liner-bot] status write failed:", e.message);
  }
}
setInterval(() => touchStatus(), 15_000).unref();
touchStatus();

// ---------- hosted runtime (running.sh container) ----------
// The sandbox runs next to the git checkout; a hosted container does not, so
// it clones the watch repo once on boot (public repo, no credentials baked
// in), serves /health on $PORT for the platform health check, and self-pings
// to defeat free-tier idle sleep (an outbound gateway socket does not count
// as traffic). Every branch is inert without running.sh's env markers.
if (process.env.RUNNING_HEALTH_CHECK || process.env.RUNNING_PUBLIC_DOMAIN) {
  const { createServer } = await import("node:http");
  createServer((req, res) => {
    if (req.url === "/health") {
      const ageMs = Date.now() - new Date(STATUS.heartbeat).getTime();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          online: STATUS.status === "online" && ageMs >= 0 && ageMs < 90_000,
          status: STATUS.status,
          bot: STATUS.bot_username,
          guildCount: STATUS.guild_count,
          startedAt: STATUS.started_at,
          lastReadyAt: STATUS.last_ready_at,
          heartbeatAgeSec: ageMs >= 0 ? Math.round(ageMs / 1000) : null,
        }),
      );
    } else {
      res.writeHead(204);
      res.end();
    }
  }).listen(Number(process.env.PORT || 3000), "0.0.0.0");
  console.log(`[liner-bot] health server on 0.0.0.0:${process.env.PORT || 3000}`);
  if (process.env.RUNNING_PUBLIC_DOMAIN) {
    const selfUrl = `https://${process.env.RUNNING_PUBLIC_DOMAIN}/health`;
    setInterval(() => fetch(selfUrl).catch(() => {}), 4 * 60_000).unref();
    console.log(`[liner-bot] keepalive self-ping → ${selfUrl} every 4m`);
  }
}

// Clone the watch repo in the background — login must never wait on it. A
// partial clone (no blobs, no checkout) keeps it light on free-tier memory:
// the watcher only ever needs commit objects (rev-parse, log, fetch).
if (process.env.CLONE_URL && !fs.existsSync(path.join(REPO_DIR, ".git"))) {
  (async () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      if (fs.existsSync(path.join(REPO_DIR, ".git"))) return;
      console.log(
        `[liner-bot] hosted boot: cloning ${process.env.CLONE_URL} → ${REPO_DIR} (attempt ${attempt})`,
      );
      const err = await new Promise((resolve) =>
        execFile(
          "git",
          [
            "clone", "--quiet", "--filter=blob:none", "--no-checkout",
            "--single-branch", "--branch", REPO_BRANCH,
            process.env.CLONE_URL, REPO_DIR,
          ],
          { timeout: 180_000, maxBuffer: 8e6 },
          (e) => resolve(e),
        ),
      );
      if (!err) {
        console.log("[liner-bot] clone complete — commit watcher armed");
        return;
      }
      console.error(`[liner-bot] clone failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, Math.min(attempt * 10_000, 60_000)));
    }
    console.error("[liner-bot] no repo checkout — commit watcher stays idle until restart");
  })();
}

// ---------- git helpers ----------
const g = (args) =>
  new Promise((resolve) => {
    execFile("git", ["-C", REPO_DIR, ...args], { timeout: 20_000, maxBuffer: 8e6 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: String(err.message || err) });
      resolve({ ok: true, out: String(stdout) });
    });
  });

async function repoLabel() {
  const url = await g(["remote", "get-url", REPO_REMOTE]);
  if (url.ok) {
    const m = String(url.out).trim().match(/github\.com[:/](.+?)(?:\.git)?$/i);
    if (m) return m[1];
    // non-github remote (mirror): still take owner/repo from the path
    const p = String(url.out).trim().replace(/\.git$/, "").split(/[/:]/).filter(Boolean);
    if (p.length >= 2) return p.slice(-2).join("/");
  }
  return REPO_SLUG; // env override / known repo — never a bare dirname like "repo"
}
// LABEL is resolved lazily, NOT at boot: the hosted container clones the repo
// in the background, so a boot-time snapshot races the clone and used to
// freeze the label to the bare dirname ("repo") — which produced the dead
// github.com/repo/compare/... buttons.
const REPO_SLUG = (process.env.WATCH_REPO_SLUG || "spotis11/Liner-Website-Port").replace(/\.git$/, "");
let _label = process.env.WATCH_REPO_SLUG || null;
async function label() {
  if (!_label) {
    _label = await repoLabel();
    console.log(`[liner-bot] repo label resolved: ${_label}`);
    STATUS.watching = `${_label}@${REPO_BRANCH}`;
  }
  return _label;
}

async function remoteSha() {
  const r = await g(["rev-parse", `${REPO_REMOTE}/${REPO_BRANCH}`]);
  return r.ok ? r.out.trim() : null;
}
async function commitsBetween(oldSha, newSha) {
  const r = await g([
    "log",
    `${oldSha}..${newSha}`,
    "--format=%H%x1f%h%x1f%s%x1f%ae%x1f%an%x1f%aI",
    "--reverse",
  ]);
  if (!r.ok) return [];
  return r.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [full, short, subject, email, name, date] = line.split("\x1f");
      const gh = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
      return { full, short, subject, author: gh ? gh[1] : name || email, date };
    });
}

function relTime(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const steps = [
    [31536000, "year"], [2592000, "month"], [604800, "week"],
    [86400, "day"], [3600, "hour"], [60, "minute"],
  ];
  for (const [sec, unit] of steps) {
    if (s >= sec) {
      const n = Math.floor(s / sec);
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

// ---------- embed builder (matches the original Liner System style) ----------
function commitEmbed(label, commits) {
  const last = commits[commits.length - 1];
  const lines = commits.slice(0, 10).map(
    (c) => `\`${c.short}\` ${c.subject.replace(/[*`_]/g, "")} *${c.author}*`
  );
  if (commits.length > 10) lines.push(`...and ${commits.length - 10} more commit(s)`);
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(`[${label.split("/")[1] || label}] ${commits.length} new commit${commits.length === 1 ? "" : "s"}`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `GitHub • ${label} • ${relTime(last.date)}`, iconURL: FOOTER_ICON })
    .setTimestamp(new Date(last.date));
  if (THUMB) embed.setThumbnail(THUMB);
  const url =
    commits.length === 1
      ? `https://github.com/${label}/commit/${last.full}`
      : `https://github.com/${label}/compare/${commits[0].short}...${last.full}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Open on GitHub").setStyle(ButtonStyle.Link).setURL(url)
  );
  return { embeds: [embed], components: [row] };
}

// ---------- announce channel resolution ----------
let announceChannelId = ANNOUNCE_CHANNEL_ID || state.commitchannelId || null;

async function resolveAnnounceChannel(client) {
  if (announceChannelId) {
    const ch = await client.channels.fetch(announceChannelId).catch(() => null);
    if (ch && ch.isTextBased() &&
        (ch.permissionsFor(ch.guild.members.me)?.has(PermissionFlagsBits.SendMessages) ?? true)) {
      return ch;
    }
  }
  for (const guild of client.guilds.cache.values()) {
    const channels = [...guild.channels.cache.values()].filter((c) => c.isTextBased());
    const byName = channels.find((c) => /commit|github|changelog|git[-_]?log|bot[-_]?log/i.test(c.name));
    const fallback = channels.find(
      (c) =>
        c.type === 0 &&
        c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)
    );
    const picked = byName || fallback;
    if (picked) {
      announceChannelId = picked.id;
      state.commitchannelId = picked.id;
      writeJsonAtomic(STATE_PATH, state);
      console.log(`[liner-bot] announce channel auto-set to #${picked.name} (${guild.name})`);
      return picked;
    }
  }
  return null;
}

async function announce(client, payload, what) {
  const ch = await resolveAnnounceChannel(client);
  if (!ch) {
    console.error(`[liner-bot] no announce channel available — dropped ${what}`);
    return false;
  }
  await ch.send(payload);
  console.log(`[liner-bot] announced ${what} in #${ch.name}`);
  return true;
}

// ---------- commit watcher ----------
let watching = false;
async function pollOnce(client) {
  if (!state.lastAnnouncedSha) {
    const cur = await remoteSha();
    if (cur) {
      state.lastAnnouncedSha = cur;
      writeJsonAtomic(STATE_PATH, state);
    }
    return;
  }
  const fetched = await g(["fetch", REPO_REMOTE, REPO_BRANCH, "--quiet"]);
  if (!fetched.ok) {
    console.error(`[liner-bot] poll: git fetch failed: ${fetched.error.split("\n")[0]}`);
    return; // offline blip — next tick retries
  }
  const cur = await remoteSha();
  if (!cur || cur === state.lastAnnouncedSha) return;
  const commits = await commitsBetween(state.lastAnnouncedSha, cur);
  if (!commits.length) {
    state.lastAnnouncedSha = cur; // force-update / branch reset
    writeJsonAtomic(STATE_PATH, state);
    return;
  }
  const ok = await announce(client, commitEmbed(await label(), commits), `${commits.length} commit(s) ${commits[0].short}..${commits[commits.length - 1].short}`);
  console.log(`[liner-bot] poll: ${commits.length} new commit(s) ${commits[0].short}..${commits[commits.length - 1].short} — ${ok ? "announced" : "NO CHANNEL, dropped"}`);
  if (ok) {
    state.lastAnnouncedSha = cur;
    writeJsonAtomic(STATE_PATH, state);
  }
}
function startWatcher(client) {
  watching = true;
  STATUS.watching = `${REPO_SLUG}@${REPO_BRANCH}`;
  console.log(`[liner-bot] commit watcher armed: ${REPO_SLUG}@${REPO_BRANCH} every ${POLL_MS / 1000}s (repo dir: ${REPO_DIR}, clone url: ${process.env.CLONE_URL || "none — using checkout"})`);
  setTimeout(() => pollOnce(client).catch((e) => console.error("[liner-bot] poll error:", e.message)), 5_000);
  setInterval(() => pollOnce(client).catch((e) => console.error("[liner-bot] poll error:", e.message)), POLL_MS);
}

// ---------- presence (custom status, forever) ----------
function assertPresence(client) {
  try {
    client.user.setPresence({
      status: "online",
      activities: [{ name: PRESENCE, type: ActivityType.Custom, state: PRESENCE }],
    });
  } catch (e) {
    console.error("[liner-bot] presence failed:", e.message);
  }
}

// ---------- client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

function has(msg, perm) {
  return msg.member?.permissions?.has(perm) ?? false;
}
function lockState(ch, allow) {
  return ch.permissionOverwrites.edit(ch.guild.roles.everyone, { SendMessages: allow });
}

// ---------- moderation helpers (.ban / .timeout) ----------
// Parses ".cmd <@user|userid>[,] [duration] reason" → { userId, reason, durationMs? }.
// Mention or raw snowflake ID accepted; reason is everything after the target
// (a leading comma between target and reason is tolerated).
function parseModTarget(content, cmdName) {
  const rest = content.slice(1 + cmdName.length).trim();
  if (!rest) return null;
  let userId = null;
  let tail = rest;
  const mention = rest.match(/^<@!?(\d{15,20})>\s*,?\s*([\s\S]*)$/);
  if (mention) {
    userId = mention[1];
    tail = mention[2];
  } else {
    const id = rest.match(/^(\d{15,20})\s*,?\s*([\s\S]*)$/);
    if (id) {
      userId = id[1];
      tail = id[2];
    }
  }
  if (!userId) return null;
  return { userId, reason: tail.trim() };
}
// "10m" / "1h" / "30s" / "2d" → ms (max 28d per Discord). Returns null if no token.
function parseDurationToken(reason) {
  const m = reason.match(/^(\d{1,4})\s*([smhd])\b\s*/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase()];
  return { ms: n * mult, consumed: m[0] };
}
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
const MAX_TIMEOUT_MS = 28 * 86_400_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000; // 10 minutes if no duration token given

// Verifies the bot and the moderator can act on the target by role hierarchy.
// Returns a human-readable error string, or null when the action is allowed.
function hierarchyError(guild, modMember, targetMember) {
  if (!targetMember) return "Member not found in this server.";
  if (targetMember.id === guild.ownerId) return "Cannot act on the server owner.";
  const targetTop = targetMember.roles.highest.position;
  const myTop = guild.members.me.roles.highest.position;
  const modTop = modMember.roles.highest.position;
  if (targetTop >= myTop) return "I cannot act on that member — their role is equal to or above mine.";
  if (targetTop >= modTop) return "You cannot act on a member whose role is equal to or above yours.";
  if (targetMember.user?.bot) return "Cannot act on another bot.";
  return null;
}
function modEmbed(title, fields) {
  const e = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(title)
    .addFields(fields)
    .setFooter({ text: "Liner System" })
    .setTimestamp();
  if (THUMB) e.setThumbnail(THUMB);
  return e;
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[liner-bot] Bot is ONLINE! Logged in as ${c.user.tag} (${c.user.id})`);
  touchStatus({
    status: "online",
    last_ready_at: new Date().toISOString(),
    bot_username: c.user.tag,
    guild_count: c.guilds.cache.size,
  });
  assertPresence(client);
  setInterval(() => assertPresence(client), 5 * 60_000).unref(); // re-assert forever
  await resolveAnnounceChannel(client);
  touchStatus({ announce_channel: announceChannelId });
  startWatcher(client);
});

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  const content = msg.content?.trim() || "";
  if (!content.startsWith(".")) return;
  const [cmd, ...args] = content.slice(1).split(/\s+/);
  const lower = cmd.toLowerCase();
  try {
    if (lower === "lock") {
      if (!has(msg, PermissionFlagsBits.ManageChannels)) return;
      await lockState(msg.channel, false);
      await msg.reply("Channel locked. Only members with Manage Channels can speak here.");
    } else if (lower === "unlock") {
      if (!has(msg, PermissionFlagsBits.ManageChannels)) return;
      await lockState(msg.channel, null);
      await msg.reply("Channel unlocked.");
    } else if (lower === "ban") {
      // .ban @user|userid[, reason]  — requires Ban Members
      if (!has(msg, PermissionFlagsBits.BanMembers)) return;
      const parsed = parseModTarget(content, "ban");
      if (!parsed) return void msg.reply("Usage: `.ban @user/userid, reason`");
      const { userId, reason } = parsed;
      const target = await msg.guild.members.fetch(userId).catch(() => null);
      if (target) {
        const err = hierarchyError(msg.guild, msg.member, target);
        if (err) return void msg.reply(err);
      }
      // Delete the banned user's messages from the last day (Discord max: 7 days).
      await msg.guild.bans.create(userId, {
        deleteMessageSeconds: 60 * 60 * 24,
        reason: `${msg.author.tag}: ${reason || "No reason provided"}`,
      });
      await msg.channel.send({
        embeds: [
          modEmbed("Member Banned", [
            { name: "User", value: `<@${userId}>\n\`${userId}\``, inline: true },
            { name: "Moderator", value: `${msg.author}\n\`${msg.author.tag}\``, inline: true },
            { name: "Reason", value: reason || "No reason provided" },
          ]),
        ],
      });
    } else if (lower === "timeout") {
      // .timeout @user|userid[, duration reason]  — requires Moderate Members
      if (!has(msg, PermissionFlagsBits.ModerateMembers)) return;
      const parsed = parseModTarget(content, "timeout");
      if (!parsed) return void msg.reply("Usage: `.timeout @user/userid, reason` (optional duration first, e.g. `30m` or `1h`)");
      let { userId, reason } = parsed;
      let durationMs = DEFAULT_TIMEOUT_MS;
      const dur = parseDurationToken(reason);
      if (dur) {
        durationMs = dur.ms;
        reason = reason.slice(dur.consumed.length).trim();
      }
      if (durationMs < 1000) return void msg.reply("Duration too short (minimum 1s).");
      if (durationMs > MAX_TIMEOUT_MS) return void msg.reply("Timeout cannot exceed 28 days.");
      const target = await msg.guild.members.fetch(userId).catch(() => null);
      if (!target) return void msg.reply("Member not found in this server.");
      const err = hierarchyError(msg.guild, msg.member, target);
      if (err) return void msg.reply(err);
      await target.timeout(durationMs, `${msg.author.tag}: ${reason || "No reason provided"}`);
      await msg.channel.send({
        embeds: [
          modEmbed("Member Timed Out", [
            { name: "User", value: `<@${userId}>\n\`${userId}\``, inline: true },
            { name: "Duration", value: formatDuration(durationMs), inline: true },
            { name: "Moderator", value: `${msg.author}\n\`${msg.author.tag}\``, inline: true },
            { name: "Reason", value: reason || "No reason provided" },
          ]),
        ],
      });
    } else if (lower === "ping") {
      await msg.reply(`Pong! ${Math.max(0, Math.round(client.ws.ping))}ms`);
    } else if (lower === "commits") {
      const n = Math.min(10, Math.max(1, parseInt(args[0], 10) || 5));
      const r = await g(["log", `${REPO_REMOTE}/${REPO_BRANCH}`, "-n", String(n), "--format=%H%x1f%h%x1f%s%x1f%ae%x1f%an%x1f%aI"]);
      if (!r.ok) return void msg.reply("Git log unavailable right now.");
      const commits = r.out.split("\n").filter(Boolean).map((line) => {
        const [full, short, subject, email, name, date] = line.split("\x1f");
        const gh = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
        return { full, short, subject, author: gh ? gh[1] : name || email, date };
      });
      await msg.channel.send(commitEmbed(await label(), commits));
    } else if (lower === "commitchannel") {
      if (!has(msg, PermissionFlagsBits.ManageChannels)) return;
      const ch = msg.mentions.channels.first() || msg.channel;
      announceChannelId = ch.id;
      state.commitchannelId = ch.id;
      writeJsonAtomic(STATE_PATH, state);
      touchStatus({ announce_channel: ch.id });
      await msg.reply(`Commit announcements will now post in <#${ch.id}>.`);
    } else if (lower === "status") {
      await msg.reply(
        `Liner System — online. Watching ${await label()}@${REPO_BRANCH} every ${Math.round(POLL_MS / 1000)}s.` +
          (announceChannelId ? ` Announcing in <#${announceChannelId}>.` : " No announce channel yet.")
      );
    } else if (lower === "help") {
      await msg.reply(
        [
          "Liner System commands:",
          ".lock — lock this channel (Manage Channels)",
          ".unlock — unlock this channel",
          ".ban @user/userid, reason — ban a member (Ban Members)",
          ".timeout @user/userid, reason — timeout a member, default 10m (Moderate Members)",
          "  optional duration token first, e.g. `.timeout @user 1h spam`",
          ".commits [n] — recent commits from the website repo",
          ".commitchannel #channel — where commit announcements post",
          ".status — watcher status",
          ".ping — latency check",
        ].join("\n")
      );
    }
  } catch (e) {
    console.error("[liner-bot] command error:", e.message);
  }
});

// hard-fail fast so the supervisor restarts us instead of hanging broken
client.on(Events.Error, (e) => console.error("[liner-bot] client error:", e.message));
process.on("unhandledRejection", (e) => {
  console.error("[liner-bot] unhandled rejection:", e);
  process.exit(1);
});
process.on("uncaughtException", (e) => {
  console.error("[liner-bot] uncaught exception:", e);
  process.exit(1);
});

client.login(TOKEN).catch((e) => {
  const msg = String(e?.message || e);
  if (/disallowed intents/i.test(msg)) {
    console.error(
      "[liner-bot] MESSAGE CONTENT INTENT is not enabled for this app in the Discord dev portal — " +
        "restarting without it (presence + commit watcher still work; . commands need the portal toggle)."
    );
    const reduced = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    reduced.once(Events.ClientReady, async (c) => {
      console.log(`[liner-bot] Bot is ONLINE! Logged in as ${c.user.tag} (reduced intents)`);
      touchStatus({
        status: "online",
        last_ready_at: new Date().toISOString(),
        bot_username: c.user.tag,
        guild_count: c.guilds.cache.size,
      });
      assertPresence(reduced);
      setInterval(() => assertPresence(reduced), 5 * 60_000).unref();
      await resolveAnnounceChannel(reduced);
      touchStatus({ announce_channel: announceChannelId });
      startWatcher(reduced);
    });
    reduced.on(Events.Error, (e2) => console.error("[liner-bot] client error:", e2.message));
    reduced.login(TOKEN).catch((e2) => {
      console.error("[liner-bot] login failed even with reduced intents:", e2?.message || e2);
      process.exit(1);
    });
    return;
  }
  console.error("[liner-bot] login failed:", msg);
  process.exit(1);
});
