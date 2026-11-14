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
  if (!url.ok) return path.basename(REPO_DIR);
  const m = String(url.out).trim().match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return m ? m[1] : path.basename(REPO_DIR);
}
const LABEL = await repoLabel();

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
  if (!fetched.ok) return; // offline blip — next tick retries
  const cur = await remoteSha();
  if (!cur || cur === state.lastAnnouncedSha) return;
  const commits = await commitsBetween(state.lastAnnouncedSha, cur);
  if (!commits.length) {
    state.lastAnnouncedSha = cur; // force-update / branch reset
    writeJsonAtomic(STATE_PATH, state);
    return;
  }
  const ok = await announce(client, commitEmbed(LABEL, commits), `${commits.length} commit(s) ${commits[0].short}..${commits[commits.length - 1].short}`);
  if (ok) {
    state.lastAnnouncedSha = cur;
    writeJsonAtomic(STATE_PATH, state);
  }
}
function startWatcher(client) {
  watching = true;
  STATUS.watching = `${LABEL}@${REPO_BRANCH}`;
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
      await msg.channel.send(commitEmbed(LABEL, commits));
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
        `Liner System — online. Watching ${LABEL}@${REPO_BRANCH} every ${Math.round(POLL_MS / 1000)}s.` +
          (announceChannelId ? ` Announcing in <#${announceChannelId}>.` : " No announce channel yet.")
      );
    } else if (lower === "help") {
      await msg.reply(
        [
          "Liner System commands:",
          ".lock — lock this channel (Manage Channels)",
          ".unlock — unlock this channel",
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
