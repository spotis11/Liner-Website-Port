// Alfredo Discord bot — Node.js edition (hosted on running.sh).
// Entry point: gateway client, "." prefix dispatch, slash commands, /health.
// The bot token comes from the DISCORD_BOT_TOKEN env var (set on the
// running.sh service) — never stored in this repository.
"use strict";

const http = require("http");
const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
} = require("discord.js");
const { MusicManager } = require("./lib/music");
const { registry, ALIASES } = require("./lib/commands");
const { store } = require("./lib/store");
const configCommands = require("./lib/commands_config");

configCommands.register(registry);

const PORT = Number(process.env.PORT) || 3000;
const BOOT_TS = Date.now();

function log(...parts) {
  console.log(`[alfredo] ${new Date().toISOString()}`, ...parts);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const music = new MusicManager(client);

// ---------------------------------------------------------------------------
// Unified command context (text message or slash interaction)
// ---------------------------------------------------------------------------
function makeTextCtx(msg) {
  const prefix = store.prefixOf(msg.guild.id);
  return {
    isSlash: false,
    client,
    guild: msg.guild,
    channel: msg.channel,
    member: msg.member,
    user: msg.author,
    args: msg.content.slice(prefix.length).trim().split(/\s+/).slice(1),
    voiceChannel: msg.member?.voice?.channel ?? null,
    mentionedUser: msg.mentions?.users?.first() ?? null,
    reply: (payload) => msg.reply(payload),
    edit: (handle, payload) => handle?.edit?.(payload),
    send: (payload) => msg.channel.send(payload),
  };
}

function makeSlashCtx(interaction, args) {
  return {
    isSlash: true,
    client,
    guild: interaction.guild,
    channel: interaction.channel,
    member: interaction.member,
    user: interaction.user,
    args,
    voiceChannel: interaction.member?.voice?.channel ?? null,
    mentionedUser: interaction.options?.getUser?.("user") ?? null,
    reply: async (payload) => {
      await interaction.deferReply();
      // normalize: text handles (from .reply) get .edit()ed later
      return { edit: (p) => interaction.editReply(p), delete: () => interaction.deleteReply() };
    },
    edit: (handle, payload) => handle?.edit?.(payload),
    send: async (payload) => {
      if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
      return interaction.reply(payload);
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const cooldowns = new Map();

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.inGuild() || msg.author.bot) return;
    // AFK notices: anyone mentioned while AFK gets a status reply
    if (msg.mentions.users.size) {
      for (const afk of store.afkMentions(msg.guild.id, [...msg.mentions.users.keys()])) {
        msg.reply(`💤 <@${afk.id}> is AFK: ${afk.reason} (since <t:${Math.floor(new Date(afk.since).getTime() / 1000)}:R>)`).catch(() => {});
      }
    }
    // AFK auto-clear when the AFK user themselves speaks
    if (store.getAfk(msg.guild.id, msg.author.id)) {
      store.clearAfk(msg.guild.id, msg.author.id);
      msg.reply(`👋 Welcome back <@${msg.author.id}> — AFK cleared.`).catch(() => {});
    }
    const content = msg.content ?? "";
    const prefix = store.prefixOf(msg.guild.id);
    if (!content.startsWith(prefix)) return;
    const raw = content.slice(prefix.length).trim();
    if (!raw) return;
    const parts = raw.split(/\s+/);
    let cmd = parts[0].toLowerCase().replace(/[^\x21-\x7e]/g, "");
    if (!cmd) return;
    cmd = ALIASES[cmd] || cmd;
    const handler = registry[cmd];
    if (!handler) {
      // ported from alfredo.py: user-defined per-guild custom commands
      const response = configCommands.customCommandLookup({ store, guild: msg.guild }, cmd);
      if (response != null) await msg.reply({ content: response });
      return;
    }
    // light anti-spam cooldown per (user, command)
    const key = `${msg.author.id}:${cmd}`;
    const now = Date.now();
    if (cooldowns.has(key) && now - cooldowns.get(key) < 1500) return;
    cooldowns.set(key, now);
    if (cooldowns.size > 5000) cooldowns.clear();

    const ctx = makeTextCtx(msg);
    ctx.store = store;
    log(`cmd ${prefix}${cmd} by ${msg.author.tag} in ${msg.guild.name}`);
    await handler(ctx);
  } catch (err) {
    log("command error:", err.stack || err.message);
    msg.reply(`❌ ${err.message}`).catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;
    const args = [interaction.options.getString("query") || ""].filter(Boolean);
    const handler = registry[cmd];
    if (!handler) {
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
      return;
    }
    log(`slash /${cmd} by ${interaction.user.tag}`);
    const ctx = makeSlashCtx(interaction, args);
    ctx.store = store;
    await handler(ctx);
  } catch (err) {
    log("interaction error:", err.stack || err.message);
    if (interaction.deferred || interaction.replied) {
      interaction.editReply(`❌ ${err.message}`).catch(() => {});
    } else {
      interaction.reply({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
    }
  }
});

client.once(Events.ClientReady, async (c) => {
  log(`ready: logged in as ${c.user.tag} — ${c.guilds.cache.size} guild(s)`);
  try {
    // Parity with alfredo.py's slash surface (/playmusic, /lyrics)
    const body = [
      new SlashCommandBuilder().setName("playmusic").setDescription("Play a song in your voice channel (YouTube Music, no ads).")
        .addStringOption((o) => o.setName("query").setDescription("Song name, 'song (by artist)', or YouTube URL").setRequired(true)),
      new SlashCommandBuilder().setName("lyrics").setDescription("Show lyrics for the current or given song.")
        .addStringOption((o) => o.setName("query").setDescription("Song name (optional if something is playing)")),
      new SlashCommandBuilder().setName("ping").setDescription("Bot latency check."),
    ].map((b) => b.toJSON());
    await c.application.commands.set(body);
    log("slash commands registered");
  } catch (err) {
    log("slash registration failed:", err.message);
  }
});

client.on(Events.Error, (err) => log("client error:", err.message));
client.on(Events.Warn, (m) => log("client warn:", m));

// Reminder delivery — due reminders fire into their original channel
setInterval(() => {
  for (const r of store.takeDueReminders()) {
    const channel = client.channels.cache.get(r.channelId);
    (channel?.isTextBased() ? channel : null)
      ?.send(`⏰ <@${r.userId}> Reminder #${r.id}: ${r.text}`)
      .catch(() => {});
  }
}, 30_000).unref();

// ---------------------------------------------------------------------------
// Health endpoint (running.sh healthcheck: port 3000 /health)
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  if ((req.url || "/").split("?")[0] === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "alfredo-bot",
      runtime: "node",
      node: process.version,
      uptime_s: Math.round((Date.now() - BOOT_TS) / 1000),
      guilds: client.guilds?.cache?.size ?? 0,
      logged_in: Boolean(client.user),
      bot: client.user?.tag ?? null,
      heartbeat: new Date().toISOString(),
    }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found", hint: "GET /health" }));
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  log("FATAL: DISCORD_BOT_TOKEN env var is not set");
  process.exit(1);
}

server.listen(PORT, () => log(`health server on :${PORT}`));

client.login(token).catch((err) => {
  log("FATAL: login failed:", err.message);
  process.exit(1);
});

process.on("SIGTERM", () => {
  log("SIGTERM — shutting down");
  for (const [gid] of music.state) music.cleanup(gid, "shutdown");
  server.close();
  client.destroy();
  process.exit(0);
});
