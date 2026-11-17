// Alfredo presence + warnings/cases + role/nick/voice mod commands.
// Ported from alfredo.py (.botstatus/.botactivity/.botactivityclear,
// warn system with cases, addrole/removerole, setnick, deafen, banlist).
"use strict";

const { EmbedBuilder, PermissionFlagsBits, ActivityType, PresenceUpdateStatus } = require("discord.js");
const { store } = require("./store");

const BLUE = 0x5865f2;
const ORANGE = 0xe67e22;

const ACTIVITY_TYPES = { playing: ActivityType.Playing, watching: ActivityType.Watching, listening: ActivityType.Listening, streaming: ActivityType.Streaming };
const STATUSES = { online: PresenceUpdateStatus.Online, idle: PresenceUpdateStatus.Idle, dnd: PresenceUpdateStatus.DoNotDisturb, invisible: PresenceUpdateStatus.Invisible };

/** Apply the persisted custom status on boot and after .botstatus/.botactivity */
function applyPresence(client) {
  const p = store.getPresence();
  if (!p) return;
  const activity = p.text
    ? { name: p.text, type: ACTIVITY_TYPES[p.type] || ActivityType.Listening, ...(p.type === "streaming" ? { url: "https://twitch.tv/lineralfredo" } : {}) }
    : null;
  try {
    client.user.setPresence({ status: STATUSES[p.status] || PresenceUpdateStatus.Online, activities: activity ? [activity] : [] });
  } catch (e) {
    console.error("[alfredo] presence apply failed:", e.message);
  }
}

function register(registry) {
  // ---------- CUSTOM STATUS (bot admin) ----------
  registry.botstatus = async (ctx) => {
    if (ctx.user.id !== process.env.BOT_ADMIN_ID && !ctx.member.permissions.has(PermissionFlagsBits.Administrator)) return ctx.reply("Bot admin only.");
    const s = (ctx.args[0] || "").toLowerCase();
    if (!STATUSES[s]) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}botstatus <online|idle|dnd|invisible>\``);
    const p = store.getPresence() || { status: "online", type: "listening", text: "" };
    p.status = s;
    store.setPresence(p);
    applyPresence(ctx.client);
    await ctx.reply(`✅ Status: ${s}`);
  };
  registry.botactivity = async (ctx) => {
    if (ctx.user.id !== process.env.BOT_ADMIN_ID && !ctx.member.permissions.has(PermissionFlagsBits.Administrator)) return ctx.reply("Bot admin only.");
    const type = (ctx.args[0] || "").toLowerCase();
    if (ctx.args.length < 2 || !ACTIVITY_TYPES[type]) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}botactivity <playing|watching|listening|streaming> <text>\``);
    const p = store.getPresence() || { status: "online" };
    p.type = type;
    p.text = ctx.args.slice(1).join(" ").slice(0, 128);
    store.setPresence(p);
    applyPresence(ctx.client);
    await ctx.reply(`✅ Activity set: ${type} **${p.text}**`);
  };
  registry.botactivityclear = async (ctx) => {
    if (ctx.user.id !== process.env.BOT_ADMIN_ID && !ctx.member.permissions.has(PermissionFlagsBits.Administrator)) return ctx.reply("Bot admin only.");
    const p = store.getPresence() || { status: "online" };
    p.text = "";
    store.setPresence(p);
    applyPresence(ctx.client);
    await ctx.reply("✅ Activity cleared.");
  };

  // ---------- WARN SYSTEM (with cases) ----------
  registry.warn = async (ctx) => {
    requireMod(ctx);
    const target = ctx.mentionedUser;
    if (!target) return ctx.reply("Usage: `.warn @user <reason>`");
    if (target.bot) return ctx.reply("You can't warn a bot.");
    const reason = ctx.args.slice(1).join(" ") || "No reason given";
    const { warnIndex, caseId } = store.addWarning(ctx.guild.id, target.id, reason, ctx.user.tag);
    const total = store.getWarnings(ctx.guild.id, target.id).length;
    await ctx.reply(`⚠️ Warned <@${target.id}> — ${reason}\n(case #${caseId} • total warnings: ${total})`);
  };
  registry.warns = warnList;
  registry.warnlist = warnList;
  async function warnList(ctx) {
    const target = ctx.mentionedUser || ctx.user;
    const list = store.getWarnings(ctx.guild.id, target.id);
    if (!list.length) return ctx.reply(`✅ <@${target.id}> has no warnings.`);
    const desc = list.map((w, i) => `**${i + 1}.** ${w.reason} — by ${w.by} *(${w.at.slice(0, 10)})*`).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle(`⚠️ Warnings — ${target.username} (${list.length})`).setDescription(desc)] });
  }
  registry.delwarn = async (ctx) => {
    requireMod(ctx);
    const target = ctx.mentionedUser;
    const i = Number(ctx.args[ctx.mentionedUser ? 1 : 0]);
    if (!target || !Number.isInteger(i)) return ctx.reply("Usage: `.delwarn @user <number>`");
    await ctx.reply(store.deleteWarning(ctx.guild.id, target.id, i - 1) ? `✅ Warning #${i} removed from <@${target.id}>.` : "Warning not found.");
  };
  registry.clearwarn = clearWarns;
  registry.clearwarns = clearWarns;
  async function clearWarns(ctx) {
    requireMod(ctx);
    const target = ctx.mentionedUser;
    if (!target) return ctx.reply("Usage: `.clearwarn @user`");
    store.clearWarnings(ctx.guild.id, target.id);
    await ctx.reply(`🧹 All warnings cleared for <@${target.id}>.`);
  }

  // ---------- CASES ----------
  registry.caseinfo = caseView;
  registry["case-view"] = caseView;
  async function caseView(ctx) {
    requireMod(ctx);
    const id = Number(ctx.args[0]);
    const c = store.getCase(ctx.guild.id, id);
    if (!c) return ctx.reply("Case not found.");
    const embed = new EmbedBuilder().setColor(BLUE).setTitle(`Case #${c.id} — ${c.type}`)
      .addFields(
        { name: "User", value: `<@${c.userId}>`, inline: true },
        { name: "Moderator", value: c.by, inline: true },
        { name: "Reason", value: c.reason || "—" },
        { name: "Date", value: `<t:${Math.floor(c.at / 1000)}:R>`, inline: true },
      );
    await ctx.reply({ embeds: [embed] });
  }
  registry["case-list"] = caseList;
  registry.caselist = caseList;
  async function caseList(ctx) {
    requireMod(ctx);
    const userId = ctx.mentionedUser?.id || null;
    const list = store.listCases(ctx.guild.id, userId).slice(-10).reverse();
    if (!list.length) return ctx.reply("No cases on record.");
    const desc = list.map((c) => `**#${c.id}** ${c.type} — <@${c.userId}>: ${c.reason || "—"} *(${new Date(c.at).toISOString().slice(0, 10)})*`).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`Cases ${userId ? `— <@${userId}>` : "(latest 10)"}`).setDescription(desc)] });
  }
  for (const name of ["case-delete", "delcase", "casedelete"]) {
    registry[name] = async (ctx) => {
      requireMod(ctx, PermissionFlagsBits.ManageGuild);
      const id = Number(ctx.args[0]);
      await ctx.reply(store.deleteCase(ctx.guild.id, id) ? `✅ Case #${id} deleted.` : "Case not found.");
    };
  }

  // ---------- ROLES / NICK / VOICE ----------
  for (const [name, add] of [["addrole", true], ["removerole", false]]) {
    registry[name] = async (ctx) => {
      requireMod(ctx, PermissionFlagsBits.ManageRoles, "Manage Roles");
      const member = ctx.mentionedUser && ctx.guild.members.cache.get(ctx.mentionedUser.id);
      const role = ctx.msg?.mentions?.roles?.first() || ctx.guild.roles.cache.find((r) => r.name.toLowerCase() === ctx.args.slice(ctx.mentionedUser ? 1 : 0).join(" ").toLowerCase());
      if (!member || !role) return ctx.reply(`Usage: \`${name} @user @role\``);
      if (role.managed) return ctx.reply("That role is managed by an integration.");
      if (add) await member.roles.add(role, `by ${ctx.user.tag}`);
      else await member.roles.remove(role, `by ${ctx.user.tag}`);
      await ctx.reply(`✅ ${add ? "Added" : "Removed"} **${role.name}** ${add ? "to" : "from"} <@${member.id}>.`);
    };
  }
  registry.setnick = async (ctx) => {
    requireMod(ctx, PermissionFlagsBits.ChangeNickname, "Change Nickname");
    const nick = ctx.args.join(" ").slice(0, 32);
    if (!nick) return ctx.reply("Usage: `.setnick <nickname>` (or mention a user with Manage Nicknames)");
    const member = ctx.mentionedUser && ctx.member.permissions.has(PermissionFlagsBits.ManageNicknames)
      ? ctx.guild.members.cache.get(ctx.mentionedUser.id) || ctx.member
      : ctx.member;
    await member.setNickname(nick === "reset" ? null : nick, `by ${ctx.user.tag}`);
    await ctx.reply(`✅ Nickname set to **${nick === "reset" ? member.user.username : nick}**.`);
  };
  registry.nick = registry.setnick;
  for (const [name, deaf] of [["deafen", true], ["undeafen", false]]) {
    registry[name] = async (ctx) => {
      requireMod(ctx, PermissionFlagsBits.DeafenMembers, "Deafen Members");
      const member = ctx.mentionedUser && ctx.guild.members.cache.get(ctx.mentionedUser.id);
      if (!member?.voice?.channel) return ctx.reply("That user isn't in a voice channel.");
      await member.voice.setDeaf(deaf, `by ${ctx.user.tag}`);
      await ctx.reply(`🔊 ${deaf ? "Deafened" : "Undeafened"} <@${member.id}>.`);
    };
  }
  registry.banlist = async (ctx) => {
    requireMod(ctx, PermissionFlagsBits.BanMembers, "Ban Members");
    const bans = await ctx.guild.bans.fetch();
    if (!bans.size) return ctx.reply("No banned users.");
    const desc = bans.map((b) => `<@${b.user.id}> — ${b.reason || "no reason"}`).slice(0, 15).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`Banned users (${bans.size})`).setDescription(desc)] });
  };
}

function requireMod(ctx, perm = PermissionFlagsBits.ModerateMembers, what = "Timeout Members") {
  if (!ctx.member.permissions.has(perm)) throw new Error(`You need the **${what}** permission to do that.`);
  if (!ctx.guild.members.me?.permissions.has(perm)) throw new Error(`I don't have the **${what}** permission — check my role.`);
}

module.exports = { register, applyPresence };
