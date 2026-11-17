// Alfredo config-surface commands — ported from alfredo.py.
// .prefix, .afk family, tags, notes, reminders, todos, custom commands.
// Same permissions and reply styles as the Python original, backed by the
// persistent store (lib/store.js) instead of the desktop app's memory.
"use strict";

const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { store } = require("./store");

const BLUE = 0x5865f2;
const GREEN = 0x57f287;

function command(registry, name, handler) {
  registry[name] = handler;
}

function requirePerms(ctx, perm, what) {
  if (!ctx.member.permissions.has(perm)) throw new Error(`You need the **${what}** permission to do that.`);
  const me = ctx.guild.members.me;
  if (!me?.permissions.has(perm)) throw new Error(`I don't have the **${what}** permission — check my role.`);
}

// "1h30m", "10m", "90s", "2d" — 1s..30d (mirrors Python parse_time range)
function parseTime(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!/^(?:\d+[smhd])+$/i.test(s)) return null;
  let total = 0;
  for (const m of s.matchAll(/(\d+)([smhd])/gi)) {
    total += Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
  }
  if (total < 1000 || total > 30 * 86400000) return null;
  return total;
}

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

function register(registry) {
  // ---------- PREFIX (admin only, per guild, persisted) ----------
  command(registry, "prefix", async (ctx) => {
    if (!ctx.member.permissions.has(PermissionFlagsBits.Administrator)) return ctx.reply("Admin only.");
    const cur = ctx.store.prefixOf(ctx.guild.id);
    if (!ctx.args.length) return ctx.reply(`Current prefix: \`${cur}\`\nUsage: \`${cur}prefix <new prefix>\` — change the command prefix for this server.\nReset to default: \`${cur}prefix reset\``);
    const next = ctx.args[0];
    if (next.toLowerCase() === "reset" || next.toLowerCase() === "default") {
      ctx.store.setPrefix(ctx.guild.id, ".");
      return ctx.reply("✅ Prefix reset to `.`");
    }
    if (next.length > 5) return ctx.reply("❌ Prefix must be 1–5 characters.");
    ctx.store.setPrefix(ctx.guild.id, next);
    await ctx.reply(`✅ Prefix changed to \`${next}\``);
  });

  // ---------- AFK ----------
  command(registry, "afk", async (ctx) => {
    const reason = ctx.args.join(" ") || "AFK";
    ctx.store.setAfk(ctx.guild.id, ctx.user.id, reason);
    await ctx.reply(`💤 AFK set: ${reason}\n(I'll tell anyone who mentions you — send any message to come back.)`);
  });
  command(registry, "afk-set", async (ctx) => {
    if (!ctx.args.length) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}afk-set <reason>\``);
    ctx.store.setAfk(ctx.guild.id, ctx.user.id, ctx.args.join(" "));
    await ctx.reply(`✅ You are now AFK: ${ctx.args.join(" ")}`);
  });
  command(registry, "afk-clear", async (ctx) => {
    ctx.store.clearAfk(ctx.guild.id, ctx.user.id);
    await ctx.reply("✅ You are no longer AFK.");
  });

  // ---------- TAGS ----------
  command(registry, "tag", async (ctx) => {
    if (!ctx.args.length) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}tag <name>\``);
    const content = ctx.store.getTag(ctx.guild.id, ctx.args[0]);
    if (content == null) return ctx.reply(`Tag \`${ctx.args[0]}\` not found.`);
    await ctx.send({ content });
  });
  for (const name of ["createtag", "addtag"]) {
    command(registry, name, async (ctx) => {
      requirePerms(ctx, PermissionFlagsBits.ManageMessages, "Manage Messages");
      if (ctx.args.length < 2) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}createtag <name> <content>\``);
      ctx.store.setTag(ctx.guild.id, ctx.args[0], ctx.args.slice(1).join(" "));
      await ctx.reply(`Tag \`${ctx.args[0]}\` created.`);
    });
  }
  command(registry, "edittag", async (ctx) => {
    requirePerms(ctx, PermissionFlagsBits.ManageMessages, "Manage Messages");
    if (ctx.args.length < 2) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}edittag <name> <content>\``);
    if (ctx.store.getTag(ctx.guild.id, ctx.args[0]) == null) return ctx.reply("Tag not found.");
    ctx.store.setTag(ctx.guild.id, ctx.args[0], ctx.args.slice(1).join(" "));
    await ctx.reply(`Tag \`${ctx.args[0]}\` updated.`);
  });
  for (const name of ["deletetag", "deltag"]) {
    command(registry, name, async (ctx) => {
      requirePerms(ctx, PermissionFlagsBits.ManageMessages, "Manage Messages");
      if (!ctx.args.length) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}deletetag <name>\``);
      await ctx.reply(ctx.store.deleteTag(ctx.guild.id, ctx.args[0]) ? `Tag \`${ctx.args[0]}\` deleted.` : `Tag \`${ctx.args[0]}\` not found.`);
    });
  }
  command(registry, "tags", async (ctx) => {
    const names = ctx.store.listTags(ctx.guild.id);
    if (!names.length) return ctx.reply("No tags.");
    await ctx.send({
      embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`Tags (${names.length})`).setDescription(names.map((t) => `\`${t}\``).join(" • "))],
    });
  });

  // ---------- NOTES (per user) ----------
  command(registry, "note", async (ctx) => {
    if (!ctx.args.length) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}note <text>\``);
    const n = ctx.store.addNote(ctx.user.id, ctx.args.join(" "));
    await ctx.reply(`📝 Note saved (#${n}).`);
  });
  command(registry, "notes", async (ctx) => {
    const notes = ctx.store.listNotes(ctx.user.id);
    if (!notes.length) return ctx.reply("No notes.");
    const desc = notes.slice(-15).map((n, i) => `**#${notes.length - Math.min(notes.length, 15) + i + 1}** ${n.text} *(${n.at.slice(0, 10)})*`).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`Your Notes (${notes.length})`).setDescription(desc)] });
  });
  command(registry, "delnote", async (ctx) => {
    const i = Number(ctx.args[0]);
    if (!Number.isInteger(i) || i < 1) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}delnote <number>\``);
    await ctx.reply(ctx.store.deleteNote(ctx.user.id, i - 1) ? `Note #${i} deleted.` : "Note not found.");
  });

  // ---------- REMINDERS ----------
  command(registry, "remind", async (ctx) => {
    if (ctx.args.length < 2) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}remind <time> <text>\` — e.g. \`${ctx.store.prefixOf(ctx.guild.id)}remind 10m stretch\` (1s–30d)`);
    const ms = parseTime(ctx.args[0]);
    if (!ms) return ctx.reply("Invalid time — use `30s`, `10m`, `2h`, `1d` or a mix like `1h30m` (1s–30d).");
    const text = ctx.args.slice(1).join(" ");
    const id = ctx.store.addReminder(ctx.user.id, ctx.channel.id, text, Date.now() + ms);
    await ctx.reply(`⏰ Reminder #${id} set for <t:${Math.floor((Date.now() + ms) / 1000)}:R>: ${text}`);
  });
  command(registry, "reminders", async (ctx) => {
    const list = ctx.store.listReminders(ctx.user.id);
    if (!list.length) return ctx.reply("No active reminders.");
    const desc = list.map((r) => `**#${r.id}** \`${r.text}\` <t:${Math.floor(r.at / 1000)}:R>`).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle("Reminders").setDescription(desc)] });
  });
  command(registry, "delreminder", async (ctx) => {
    const id = Number(ctx.args[0]);
    if (!Number.isInteger(id)) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}delreminder <id>\``);
    await ctx.reply(ctx.store.deleteReminder(ctx.user.id, id) ? `Reminder #${id} deleted.` : "Reminder not found.");
  });

  // ---------- TODOS (per user) ----------
  command(registry, "addtodo", async (ctx) => {
    if (!ctx.args.length) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}addtodo <text>\``);
    const n = ctx.store.addTodo(ctx.user.id, ctx.args.join(" "));
    await ctx.reply(`✅ Todo #${n} added: ${ctx.args.join(" ")}`);
  });
  command(registry, "todo", async (ctx) => {
    const todos = ctx.store.listTodos(ctx.user.id);
    if (!todos.length) return ctx.reply("Nothing on your todo list — add with `.addtodo <text>`.");
    const desc = todos.map((t, i) => `${i + 1}. ${t.done ? "✅" : "⬜"} ${t.text}`).join("\n");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`Your Todos (${todos.filter((t) => !t.done).length} open)`).setDescription(desc)] });
  });
  command(registry, "donetodo", async (ctx) => {
    const i = Number(ctx.args[0]);
    if (!Number.isInteger(i) || i < 1) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}donetodo <number>\``);
    await ctx.reply(ctx.store.completeTodo(ctx.user.id, i - 1) ? `🎉 Todo #${i} done!` : "Todo not found.");
  });
  command(registry, "cleartodo", async (ctx) => {
    ctx.store.clearTodos(ctx.user.id);
    await ctx.reply("🧹 Todo list cleared.");
  });

  // ---------- CUSTOM COMMANDS ----------
  command(registry, "customcmd", async (ctx) => {
    requirePerms(ctx, PermissionFlagsBits.ManageMessages, "Manage Messages");
    if (ctx.args.length < 2) {
      return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}customcmd <trigger> <response>\`\nTrigger it later with \`${ctx.store.prefixOf(ctx.guild.id)}<trigger>\` • list: \`${ctx.store.prefixOf(ctx.guild.id)}customcmds\` • delete: \`${ctx.store.prefixOf(ctx.guild.id)}delcustomcmd <trigger>\``);
    }
    ctx.store.setCustomCmd(ctx.guild.id, ctx.args[0], ctx.args.slice(1).join(" "));
    await ctx.reply(`✅ Custom command \`${ctx.args[0]}\` saved.`);
  });
  command(registry, "delcustomcmd", async (ctx) => {
    requirePerms(ctx, PermissionFlagsBits.ManageMessages, "Manage Messages");
    if (!ctx.args.length) return ctx.reply(`Usage: \`${ctx.store.prefixOf(ctx.guild.id)}delcustomcmd <trigger>\``);
    await ctx.reply(ctx.store.deleteCustomCmd(ctx.guild.id, ctx.args[0]) ? `Custom command \`${ctx.args[0]}\` deleted.` : `Custom command \`${ctx.args[0]}\` not found.`);
  });
  command(registry, "customcmds", async (ctx) => {
    const names = ctx.store.listCustomCmds(ctx.guild.id);
    if (!names.length) return ctx.reply("No custom commands — add one with `.customcmd <trigger> <response>`.");
    await ctx.send({ embeds: [new EmbedBuilder().setColor(GREEN).setTitle(`Custom commands (${names.length})`).setDescription(names.map((t) => `\`${t}\``).join(" • "))] });
  });
}

/** AFK notices + custom-command matching for the message dispatcher */
function customCommandLookup(ctx, cmd) {
  return ctx.store.getCustomCmd(ctx.guild.id, cmd);
}

module.exports = { register, customCommandLookup };
