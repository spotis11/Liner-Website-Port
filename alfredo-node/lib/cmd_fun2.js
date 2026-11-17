// Alfredo fun commands round 2 — ported from alfredo.py:
// truth/dare, compliment, dog/cat images, countdown, ship, slots,
// action commands (hug/pat/kiss/slap). NO AI commands (excluded per owner).
"use strict";

const { EmbedBuilder } = require("discord.js");

const BLUE = 0x5865f2;
const PINK = 0xff69b4;

const TRUTHS = [
  "What's the most embarrassing song on your playlist?",
  "What's the last lie you told?",
  "What's your most useless talent?",
  "Who in this server would you trade places with for a day?",
  "What's the weirdest thing you've eaten and pretended to like?",
  "What app do you waste the most time on?",
  "What's the pettiest reason you've ever held a grudge?",
  "Show the last photo in your gallery (or describe it).",
  "What's a food combination you secretly enjoy?",
  "What's the most trouble you got into at school?",
];
const DARES = [
  "Change your nickname to 'certified goober' for 10 minutes.",
  "Type the last thing you copied to your clipboard, no context.",
  "Send a voice note singing the chorus of any song.",
  "Use only emojis to talk for the next 5 messages.",
  "Do 10 jumping jacks and report back.",
  "Text someone 'the pigeons know what they did' and show the reply.",
  "Let the person who dared you pick your profile picture for a day.",
  "Say the alphabet backwards in one message.",
  "Compliment the last person who joined a voice channel.",
  "Post an old selfie of yourself.",
];
const COMPLIMENTS = [
  "Your presence alone makes everything better.",
  "You have great taste in music.",
  "The way you think is genuinely refreshing.",
  "You make this server warmer, honestly.",
  "Your avatar game is strong today.",
  "You're the kind of person who makes group chats worth opening.",
  "Even your typos have style.",
];

async function safeImage(ctx, url, title) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(9000), redirect: "follow" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await ctx.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(title).setImage(url)] });
  } catch (e) {
    await ctx.reply(`⚠️ Couldn't fetch an image right now (${e.message}).`);
  }
}

function register(registry) {
  const cmd = (name, handler) => (registry[name] = handler);

  cmd("truth", async (ctx) => {
    await ctx.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle("🟢 TRUTH").setDescription(TRUTHS[Math.floor(Math.random() * TRUTHS.length)])] });
  });
  cmd("dare", dareCmd);
  registry.dare2 = dareCmd;
  async function dareCmd(ctx) {
    await ctx.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🔴 DARE").setDescription(DARES[Math.floor(Math.random() * DARES.length)])] });
  }
  cmd("compliment", async (ctx) => {
    const target = ctx.mentionedUser ? `<@${ctx.mentionedUser.id}>, ` : "";
    await ctx.reply(`💗 ${target}${COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)]}`);
  });
  cmd("dog", async (ctx) => {
    try {
      const resp = await fetch("https://dog.ceo/api/breeds/image/random", { signal: AbortSignal.timeout(9000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const j = await resp.json();
      await ctx.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle("🐶 Woof!").setImage(j.message)] });
    } catch {
      await ctx.reply("⚠️ Couldn't fetch a dog right now.");
    }
  });
  cmd("cat", (ctx) => safeImage(ctx, `https://cataas.com/cat?${Date.now()}`, "🐱 Meow!"));

  cmd("countdown", async (ctx) => {
    const input = ctx.args.join(" ");
    if (!input) return ctx.reply("Usage: `.countdown 2026-12-25` (or a time like `2h30m`, or an event name + date)");
    const target = Date.parse(input);
    if (Number.isNaN(target)) return ctx.reply("❌ Couldn't parse that date — try `YYYY-MM-DD` or `2h30m`.");
    const diff = target - Date.now();
    if (diff <= 0) return ctx.reply("⏰ That moment already passed!");
    const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000);
    await ctx.reply(`⏳ **${d}d ${h}h ${m}m** until **${input}** (<t:${Math.floor(target / 1000)}:R>).`);
  });

  cmd("ship", async (ctx) => {
    const users = [...ctx.msg?.mentions?.users?.values() || []];
    if (users.length < 2) return ctx.reply("💘 Ship two people: `.ship @a @b`");
    const pct = Math.floor(Math.random() * 101);
    const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
    const verdict = pct >= 90 ? "💍 MATCH MADE IN HEAVEN" : pct >= 70 ? "💖 Strong match!" : pct >= 50 ? "🔥 There's something there..." : pct >= 25 ? "😬 Complicated..." : "💀 Not even friends";
    const [a, b] = users;
    await ctx.reply({ embeds: [new EmbedBuilder().setColor(PINK).setTitle(`💘 ${a.username} × ${b.username}`).setDescription(`**${pct}%**\n${bar}\n${verdict}`)] });
  });

  const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "🍇"];
  cmd("slots", async (ctx) => {
    const [a, b, c] = Array.from({ length: 3 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    const win = a === b && b === c;
    const near = !win && (a === b || b === c || a === c);
    await ctx.reply(`🎰 [ ${a} | ${b} | ${c} ] — ${win ? "🎉 **JACKPOT!**" : near ? "😐 So close!" : "💸 Better luck next time"}`);
  });
  registry.slot = registry.slots;

  const ACTIONS = { hug: "🤗", pat: "🫂", kiss: "😘", slap: "👋", poke: "👉", bite: "🦷", highfive: "🖐️" };
  for (const [action, emoji] of Object.entries(ACTIONS)) {
    cmd(action, async (ctx) => {
      const target = ctx.mentionedUser;
      if (!target) return ctx.reply(`Usage: \`.${action} @user\``);
      if (target.id === ctx.user.id && action !== "highfive") return ctx.reply(`${emoji} You ${action} yourself... bold.`);
      await ctx.send({ content: `${emoji} <@${ctx.user.id}> ${action}s <@${target.id}>!` });
    });
  }
}

module.exports = { register };
