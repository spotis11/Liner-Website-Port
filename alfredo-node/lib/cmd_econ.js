// Alfredo lite economy — ported from alfredo.py's economy family:
// daily/beg/crime/balance/pay/gamble/rob/shop/buy/inventory/additem/delitem.
// NO AI commands (excluded per owner).
"use strict";

const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { store } = require("./store");

const GOLD = 0xf1c40f;
const DAILY = 250;
const BEG_MIN = 5, BEG_MAX = 60;
const BEG_CD = 30_000, CRIME_CD = 120_000;

const fmt = (n) => `🪙 **${n}** coins`;

function register(registry) {
  const cmd = (name, handler) => (registry[name] = handler);

  cmd("daily", async (ctx) => {
    const e = store.econ(ctx.user.id);
    const left = e.lastDaily + 86400000 - Date.now();
    if (left > 0) {
      const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
      return ctx.reply(`⏰ Daily already claimed — come back in **${h}h ${m}m**.`);
    }
    e.lastDaily = Date.now();
    e.bal += DAILY;
    store.econ(ctx.user.id); // ensure reference saved
    await ctx.reply(`🎁 Daily reward: ${fmt(DAILY)}! Balance: ${fmt(e.bal)}`);
  });

  cmd("beg", async (ctx) => {
    const e = store.econ(ctx.user.id);
    const left = e.lastBeg + BEG_CD - Date.now();
    if (left > 0) return ctx.reply(`🥺 People are tired of you — try again in **${Math.ceil(left / 1000)}s**.`);
    e.lastBeg = Date.now();
    const amt = BEG_MIN + Math.floor(Math.random() * (BEG_MAX - BEG_MIN + 1));
    e.bal += amt;
    const who = ["a kind stranger", "your grandma", "Elon's intern", "a streamer", "the pizza guy"][Math.floor(Math.random() * 5)];
    await ctx.reply(`🥺 ${who} gave you ${fmt(amt)}. Balance: ${fmt(e.bal)}`);
  });

  cmd("crime", async (ctx) => {
    const e = store.econ(ctx.user.id);
    const left = e.lastCrime + CRIME_CD - Date.now();
    if (left > 0) return ctx.reply(`🚔 Lay low — next heist in **${Math.ceil(left / 1000)}s**.`);
    e.lastCrime = Date.now();
    const win = Math.random() < 0.45;
    const amt = 50 + Math.floor(Math.random() * 250);
    if (win) {
      e.bal += amt;
      await ctx.reply(`😈 Heist success! You stole ${fmt(amt)}. Balance: ${fmt(e.bal)}`);
    } else {
      const fine = Math.min(e.bal, Math.floor(amt / 2));
      e.bal -= fine;
      await ctx.reply(`🚔 Busted! Fined ${fmt(fine)}. Balance: ${fmt(e.bal)}`);
    }
  });

  for (const name of ["balance", "bal"]) {
    cmd(name, async (ctx) => {
      const target = ctx.mentionedUser || ctx.user;
      const e = store.econ(target.id);
      const items = e.items.length ? ` • Items: ${e.items.join(", ")}` : "";
      await ctx.reply(`💰 <@${target.id}> has ${fmt(e.bal)}${items}`);
    });
  }

  cmd("pay", async (ctx) => {
    const target = ctx.mentionedUser;
    const amt = Number(ctx.args[ctx.mentionedUser ? 1 : 0]);
    if (!target || !Number.isInteger(amt) || amt <= 0) return ctx.reply("Usage: `.pay @user <amount>`");
    if (target.id === ctx.user.id) return ctx.reply("Paying yourself? Nice try.");
    const me = store.econ(ctx.user.id);
    if (me.bal < amt) return ctx.reply(`You only have ${fmt(me.bal)}.`);
    me.bal -= amt;
    store.econ(target.id).bal += amt;
    await ctx.reply(`💸 Paid ${fmt(amt)} to <@${target.id}>. Your balance: ${fmt(me.bal)}`);
  });
  registry.give = registry.pay;

  cmd("gamble", async (ctx) => {
    const amt = Number(ctx.args[0]);
    const e = store.econ(ctx.user.id);
    if (!Number.isInteger(amt) || amt <= 0) return ctx.reply("Usage: `.gamble <amount>`");
    if (e.bal < amt) return ctx.reply(`You can't afford that — balance: ${fmt(e.bal)}`);
    const win = Math.random() < 0.42;
    if (win) {
      e.bal += amt;
      await ctx.reply(`🎰 Jackpot! **+${amt}** — balance: ${fmt(e.bal)}`);
    } else {
      e.bal -= amt;
      await ctx.reply(`🎰 House wins... **-${amt}** — balance: ${fmt(e.bal)}`);
    }
  });

  cmd("rob", async (ctx) => {
    const target = ctx.mentionedUser;
    if (!target) return ctx.reply("Usage: `.rob @user`");
    if (target.id === ctx.user.id) return ctx.reply("Robbing yourself is just checking your balance.");
    const me = store.econ(ctx.user.id);
    const them = store.econ(target.id);
    if (them.bal < 20) return ctx.reply("They're broke — not worth the risk.");
    const meWin = Math.random() < 0.4;
    if (meWin) {
      const amt = Math.floor(them.bal * (0.2 + Math.random() * 0.4));
      them.bal -= amt;
      me.bal += amt;
      await ctx.reply(`🦹 You robbed <@${target.id}> for ${fmt(amt)}!`);
    } else {
      const fine = Math.min(me.bal, 50 + Math.floor(Math.random() * 100));
      me.bal -= fine;
      await ctx.reply(`🚨 Caught! You paid <@${target.id}> ${fmt(fine)} in damages.`);
    }
  });

  cmd("shop", async (ctx) => {
    const s = store.shopOf(ctx.guild.id);
    const names = Object.entries(s);
    if (!names.length) return ctx.reply(`🛒 Shop is empty — admins can add items: \`.additem <name> <price>\``);
    const desc = names.map(([n, p]) => `**${n}** — ${fmt(p)}`).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(GOLD).setTitle("🛒 Server Shop").setDescription(desc)] });
  });
  cmd("buy", async (ctx) => {
    const name = (ctx.args[0] || "").toLowerCase();
    const s = store.shopOf(ctx.guild.id);
    if (!name || !(name in s)) return ctx.reply(`🛒 Item not in shop — try: \`.shop\``);
    const price = s[name];
    const e = store.econ(ctx.user.id);
    if (e.bal < price) return ctx.reply(`Not enough coins — ${fmt(price)} needed, you have ${fmt(e.bal)}.`);
    e.bal -= price;
    e.items.push(name);
    await ctx.reply(`🛍️ Bought **${name}** for ${fmt(price)}! Balance: ${fmt(e.bal)}`);
  });
  for (const name of ["inventory", "inv"]) {
    cmd(name, async (ctx) => {
      const e = store.econ(ctx.mentionedUser?.id || ctx.user.id);
      await ctx.reply(`🎒 <@${ctx.mentionedUser?.id || ctx.user.id}>'s inventory: ${e.items.length ? e.items.join(", ") : "empty"}`);
    });
  }
  cmd("additem", async (ctx) => {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return ctx.reply("You need **Manage Server** to edit the shop.");
    const price = Number(ctx.args[1]);
    if (!ctx.args[0] || !Number.isInteger(price) || price < 0) return ctx.reply("Usage: `.additem <name> <price>`");
    store.shopSet(ctx.guild.id, ctx.args[0], price);
    await ctx.reply(`✅ Added **${ctx.args[0]}** to the shop for ${fmt(price)}.`);
  });
  cmd("delitem", async (ctx) => {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return ctx.reply("You need **Manage Server** to edit the shop.");
    await ctx.reply(store.shopDelete(ctx.guild.id, ctx.args[0] || "") ? "✅ Item removed from the shop." : "Item not in the shop.");
  });

  // ---------- COUNTING GAME ----------
  cmd("counting-set", async (ctx) => {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) return ctx.reply("You need **Manage Channels** to set the counting channel.");
    const ch = ctx.msg?.mentions?.channels?.first() || ctx.channel;
    store.setCounting(ctx.guild.id, ch.id, 0);
    await ctx.reply(`🔢 Counting starts in <#${ch.id}> — begin at **1**!`);
  });
  cmd("counting-reset", async (ctx) => {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) return ctx.reply("You need **Manage Channels** to reset.");
    const c = store.getCounting(ctx.guild.id);
    if (c) store.setCounting(ctx.guild.id, c.channelId, 0);
    await ctx.reply("🔢 Counter reset to 0.");
  });
  cmd("counting", async (ctx) => {
    const c = store.getCounting(ctx.guild.id);
    await ctx.reply(c ? `🔢 Next number: **${c.count + 1}** in <#${c.channelId}>` : "No counting channel — set one with `.counting-set #channel`.");
  });
}

module.exports = { register };
