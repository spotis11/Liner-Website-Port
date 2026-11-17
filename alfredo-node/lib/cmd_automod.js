// Alfredo automod — ported from alfredo.py's anti-* toggle family:
// antilink, antiinvite, anticaps, antihoist, antiemoji, antispam.
// Toggles via commands (Manage Server), enforced by messageFilter().
"use strict";

const { PermissionFlagsBits } = require("discord.js");
const { store } = require("./store");

const KEYS = ["antilink", "antiinvite", "anticaps", "antihoist", "antiemoji", "antispam"];

// anti-spam sliding window: guild+user → timestamps
const windows = new Map();
setInterval(() => {
  const cutoff = Date.now() - 5000;
  for (const [k, arr] of windows) {
    const next = arr.filter((t) => t > cutoff);
    if (next.length) windows.set(k, next);
    else windows.delete(k);
  }
}, 10_000).unref();

const LINK_RE = /https?:\/\/\S+|www\.\S+/i;
const INVITE_RE = /discord(?:\.gg|\.com\/invite)\/\S+/i;
const HOIST_RE = /^[!-/:-@[-`{-~]+/;

function register(registry) {
  for (const key of KEYS) {
    registry[key] = async (ctx) => {
      if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return ctx.reply("You need **Manage Server** to toggle automod.");
      }
      const cfg = store.automodOf(ctx.guild.id);
      const arg = (ctx.args[0] || "").toLowerCase();
      const next = arg === "on" ? true : arg === "off" ? false : !cfg[key];
      store.automodSet(ctx.guild.id, key, next);
      await ctx.reply(`🛡️ **${key}** is now **${next ? "ON" : "OFF"}**.${key === "antispam" && next ? " (5+ messages in 5s → 10s timeout)" : ""}`);
    };
  }
  registry.automodstatus = async (ctx) => {
    const cfg = store.automodOf(ctx.guild.id);
    const lines = KEYS.map((k) => `${cfg[k] ? "✅" : "⬛"} ${k}`).join("\n");
    await ctx.reply(`🛡️ **Automod for ${ctx.guild.name}**\n${lines}`);
  };
  registry["automod-status"] = registry.automodstatus;
}

/**
 * Returns true when the message was handled (deleted/muted) and should not
 * reach the command dispatcher. Always allows admins and the bot itself.
 */
async function messageFilter(msg) {
  if (!msg.inGuild() || msg.author.bot) return false;
  if (msg.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return false;
  const cfg = store.automodOf(msg.guild.id);
  if (!KEYS.some((k) => cfg[k])) return false;

  const content = msg.content || "";
  let violation = null;
  if (cfg.antiinvite && INVITE_RE.test(content)) violation = "invite links";
  else if (cfg.antilink && LINK_RE.test(content)) violation = "links";
  else if (cfg.anticaps) {
    const letters = content.replace(/[^a-zA-Z]/g, "");
    if (letters.length >= 10 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7) violation = "excessive caps";
  } else if (cfg.antiemoji) {
    const emoji = content.match(/<a?:\w+:\d+>/g);
    if (emoji && emoji.length > 8) violation = "emoji spam";
  }

  // antihoist: check the author's nickname once per minute per member
  if (!violation && cfg.antihoist && HOIST_RE.test(msg.member.displayName || "")) {
    try {
      await msg.member.setNickname(msg.member.user.username.slice(0, 32), "antihoist automod");
      await msg.reply("⚠️ Nickname reset — special characters at the start aren't allowed here.").catch(() => {});
    } catch {}
  }

  // antispam: 5+ messages in 5s → 10s timeout
  if (!violation && cfg.antispam) {
    const key = `${msg.guild.id}:${msg.author.id}`;
    const now = Date.now();
    const arr = (windows.get(key) || []).filter((t) => t > now - 5000);
    arr.push(now);
    windows.set(key, arr);
    if (arr.length >= 5) {
      violation = "spamming";
      windows.delete(key);
    }
  }

  if (!violation) return false;
  try {
    await msg.delete();
  } catch {}
  try {
    if (violation === "spamming") {
      await msg.member.timeout(10_000, "antispam automod");
      await msg.channel.send(`⏱️ <@${msg.author.id}> timed out 10s for spamming.`).catch(() => {});
    } else {
      await msg.channel.send(`🛡️ <@${msg.author.id}>, ${violation} aren't allowed here.`).then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
    }
  } catch {}
  console.log(`[alfredo] automod ${violation} by ${msg.author.tag} in ${msg.guild.name}`);
  return true;
}

/** Counting game hook — returns true when the message was a counting turn. */
async function countingHook(msg) {
  const c = store.getCounting(msg.guild.id);
  if (!c || msg.channel.id !== c.channelId || msg.author.bot) return false;
  const n = Number((msg.content || "").trim());
  if (!Number.isInteger(n)) return false; // non-numbers pass through (commands etc.)
  if (n === c.count + 1) {
    store.setCounting(msg.guild.id, c.channelId, n);
    if (n % 50 === 0) await msg.reply(`🎉 **${n}** — ${msg.author.username} is on fire!`).catch(() => {});
    return true;
  }
  // wrong number → reset
  store.setCounting(msg.guild.id, c.channelId, 0);
  await msg.reply(`❌ Wrong number, **${msg.author.username}** — expected **${c.count + 1}**. Counter reset to 0!`).catch(() => {});
  return true;
}

module.exports = { register, messageFilter, countingHook };
