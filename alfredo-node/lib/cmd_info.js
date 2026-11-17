// Alfredo server-info commands — ported from alfredo.py read-only family:
// channelinfo/channelcount/channellist/channeltopic/channelage, roleinfo,
// emojicount/emojilist, boost-info/boosters.
"use strict";

const { EmbedBuilder, ChannelType } = require("discord.js");

const BLUE = 0x5865f2;

function register(registry) {
  const cmd = (name, handler) => (registry[name] = handler);

  cmd("channelinfo", async (ctx) => {
    const ch = ctx.msg?.mentions?.channels?.first() || ctx.channel;
    const embed = new EmbedBuilder().setColor(BLUE).setTitle(`#${ch.name} info`)
      .addFields(
        { name: "ID", value: ch.id, inline: true },
        { name: "Type", value: ChannelType[ch.type] || String(ch.type), inline: true },
        { name: "Created", value: `<t:${Math.floor(ch.createdTimestamp / 1000)}:R>`, inline: true },
      );
    if (ch.topic) embed.addFields({ name: "Topic", value: ch.topic.slice(0, 1000) });
    if (typeof ch.rateLimitPerUser === "number") embed.addFields({ name: "Slowmode", value: `${ch.rateLimitPerUser}s`, inline: true });
    if (ch.parent) embed.addFields({ name: "Category", value: ch.parent.name, inline: true });
    await ctx.reply({ embeds: [embed] });
  });
  cmd("channelcount", async (ctx) => {
    const g = ctx.guild.channels.cache;
    const text = g.filter((c) => c.type === ChannelType.GuildText).size;
    const voice = g.filter((c) => c.type === ChannelType.GuildVoice).size;
    const cats = g.filter((c) => c.type === ChannelType.GuildCategory).size;
    const stages = g.filter((c) => c.type === ChannelType.GuildStageVoice).size;
    const forums = g.filter((c) => c.type === ChannelType.GuildForum).size;
    await ctx.reply(`📋 **${ctx.guild.name}** channels: ${text} text • ${voice} voice • ${cats} categories • ${stages} stage • ${forums} forum (${g.size} total)`);
  });
  cmd("channellist", async (ctx) => {
    const byCat = new Map();
    for (const c of ctx.guild.channels.cache.values()) {
      const key = c.parent?.name || (c.type === ChannelType.GuildCategory ? "📁 Categories" : "— unsorted —");
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(c);
    }
    const desc = [...byCat.entries()].slice(0, 15).map(([cat, chans]) => {
      const list = chans.slice(0, 8).map((c) => (c.type === ChannelType.GuildVoice ? `🔊 ${c.name}` : `💬 ${c.name}`)).join(" • ");
      return `**${cat}**\n${list}${chans.length > 8 ? ` *+${chans.length - 8} more*` : ""}`;
    }).join("\n\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`Channels (${ctx.guild.channels.cache.size})`).setDescription(desc.slice(0, 3900) || "none")] });
  });
  cmd("channeltopic", async (ctx) => {
    const ch = ctx.msg?.mentions?.channels?.first() || ctx.channel;
    await ctx.reply(ch.topic ? `📌 **#${ch.name}**: ${ch.topic}` : `#${ch.name} has no topic.`);
  });
  cmd("channelage", async (ctx) => {
    const ch = ctx.msg?.mentions?.channels?.first() || ctx.channel;
    const days = Math.floor((Date.now() - ch.createdTimestamp) / 86400000);
    await ctx.reply(`📅 **#${ch.name}** was created <t:${Math.floor(ch.createdTimestamp / 1000)}:R> (${days} days ago).`);
  });

  cmd("roleinfo", async (ctx) => {
    const role = ctx.msg?.mentions?.roles?.first() || ctx.guild.roles.cache.find((r) => r.name.toLowerCase() === ctx.args.join(" ").toLowerCase());
    if (!role) return ctx.reply("Give me a role: `.roleinfo @role`");
    const embed = new EmbedBuilder().setColor(role.color || BLUE).setTitle(`@${role.name} info`)
      .addFields(
        { name: "ID", value: role.id, inline: true },
        { name: "Members", value: String(role.members.size), inline: true },
        { name: "Color", value: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "default", inline: true },
        { name: "Position", value: String(role.rawPosition), inline: true },
        { name: "Mentionable", value: role.mentionable ? "yes" : "no", inline: true },
        { name: "Created", value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true },
      );
    await ctx.reply({ embeds: [embed] });
  });
  cmd("rolecount", async (ctx) => {
    const target = ctx.msg?.mentions?.roles?.first() || ctx.guild.roles.cache.find((r) => r.name.toLowerCase() === ctx.args.join(" ").toLowerCase());
    if (target) return ctx.reply(`👥 **@${target.name}** has **${target.members.size}** member(s).`);
    const largest = [...ctx.guild.roles.cache.values()].filter((r) => r.name !== "@everyone").sort((a, b) => b.members.size - a.members.size)[0];
    await ctx.reply(`👥 **${ctx.guild.roles.cache.size}** roles on this server (largest: ${largest ? largest.name : "?"}).`);
  });
  cmd("rolelist", async (ctx) => {
    const roles = [...ctx.guild.roles.cache.values()].filter((r) => r.name !== "@everyone").sort((a, b) => b.rawPosition - a.rawPosition);
    const desc = roles.slice(0, 40).map((r) => `<@&${r.id}> (${r.members.size})`).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`Roles (${roles.length})`).setDescription(desc.slice(0, 3900) || "none")] });
  });

  cmd("emojicount", async (ctx) => {
    const s = ctx.guild.emojis.cache;
    await ctx.reply(`😀 Emojis: **${s.size}** total — ${s.filter((e) => !e.animated).size} static, ${s.filter((e) => e.animated).size} animated, ${s.filter((e) => !e.available).size} unavailable`);
  });
  cmd("emojilist", emojiList);
  registry.emojilistall = emojiList;
  async function emojiList(ctx) {
    const e = ctx.guild.emojis.cache;
    if (!e.size) return ctx.reply("This server has no custom emojis.");
    const desc = e.map((x) => `<${x.animated ? "a" : ""}:${x.name}:${x.id}> \`:${x.name}:\``).slice(0, 50).join(" ");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`Emojis (${e.size})`).setDescription(desc.slice(0, 3900))] });
  }

  cmd("boost-info", boostInfo);
  registry.boostinfo = boostInfo;
  async function boostInfo(ctx) {
    const g = ctx.guild;
    const tiers = ["None", "Level 1", "Level 2", "Level 3"];
    await ctx.reply(`🚀 **${g.name}** — ${g.premiumSubscriptionCount ?? 0} boosts • ${tiers[g.premiumTier] || g.premiumTier}${g.premiumProgressBarEnabled ? " • progress bar on" : ""}`);
  }
  cmd("boosters", async (ctx) => {
    const members = ctx.guild.members.cache.filter((m) => m.premiumSince);
    if (!members.size) return ctx.reply("No active boosters (members cache may be partial — try after the bot caches the member list).");
    const desc = members.map((m) => `<@${m.id}> since <t:${Math.floor(m.premiumSinceTimestamp / 1000)}:R>`).slice(0, 20).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(0xf47fff).setTitle(`Boosters (${members.size})`).setDescription(desc)] });
  });
}

module.exports = { register };
