// Alfredo commands — Node edition.
// Ported subset of alfredo.py's 1087-command surface: the full music suite
// (the .playmusic pipeline), core status commands, and the most-used
// fun/utility/moderation commands. Handlers receive a unified ctx so they
// work identically for "." text commands and slash interactions.
"use strict";

const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const crypto = require("crypto");
const { searchTrack, parseSongQuery } = require("./ytmsearch");
const { extractVideoId } = require("./innertube");
const { fmtDuration, COLORS } = require("./music");

const BLUE = COLORS.BLUE;
const GREEN = COLORS.GREEN;
const RED = COLORS.RED;

const registry = {};
const ALIASES = {
  unpausemusic: "resumemusic",
  skipsong: "skip",
  "music-queue": "queue",
  nowplaying: "music-now",
  leavevc: "music-leave",
  clearqueue: "clearq",
  whois: "userinfo",
  cointoss: "coinflip",
  randnum: "roll",
};

function command(name, handler) {
  registry[name] = handler;
}

function requirePerms(ctx, perm, what) {
  if (!ctx.member.permissions.has(perm)) throw new Error(`You need the **${what}** permission to do that.`);
  const me = ctx.guild.members.me;
  if (!me?.permissions.has(perm)) throw new Error(`I don't have the **${what}** permission — check my role.`);
}

// ---------------------------------------------------------------------------
// CORE
// ---------------------------------------------------------------------------
command("ping", async (ctx) => {
  const t0 = Date.now();
  const handle = await ctx.reply("🏓 Pinging ...");
  const rt = Date.now() - t0;
  await ctx.edit(handle, `🏓 Pong! WS \`${ctx.client.ws.ping}ms\` • round-trip \`${rt}ms\``);
});

command("uptime", async (ctx) => {
  const s = Math.floor(process.uptime());
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  await ctx.reply(`⏱️ Up **${d}d ${h}h ${m}m ${s % 60}s** (Node edition, since process start).`);
});

command("botinfo", async (ctx) => {
  const me = ctx.client.user;
  const embed = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(`${me.tag} — Alfredo (Node Edition)`)
    .setThumbnail(me.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Runtime", value: `Node ${process.version} • discord.js`, inline: true },
      { name: "Servers", value: String(ctx.client.guilds.cache.size), inline: true },
      { name: "Uptime", value: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`, inline: true },
      { name: "Memory", value: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB RSS`, inline: true },
      { name: "Latency", value: `${ctx.client.ws.ping}ms`, inline: true },
      { name: "Music", value: "YouTube Music → InnerTube/yt-dlp → ffmpeg", inline: false },
    )
    .setFooter({ text: "Ported from alfredo.py — .help for commands" });
  await ctx.reply({ embeds: [embed] });
});

command("serverinfo", async (ctx) => {
  const g = ctx.guild;
  const embed = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(g.name)
    .setThumbnail(g.iconURL({ size: 256 }))
    .addFields(
      { name: "ID", value: g.id, inline: true },
      { name: "Owner", value: `<@${g.ownerId}>`, inline: true },
      { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
      { name: "Members", value: String(g.memberCount), inline: true },
      { name: "Channels", value: String(g.channels.cache.size), inline: true },
      { name: "Roles", value: String(g.roles.cache.size), inline: true },
      { name: "Boosts", value: `${g.premiumSubscriptionCount ?? 0} (L${g.premiumTier})`, inline: true },
      { name: "Locale", value: g.preferredLocale || "default", inline: true },
    );
  await ctx.reply({ embeds: [embed] });
});

command("help", async (ctx) => {
  const p = ".";
  const embed = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle("Alfredo — Node Edition command list")
    .setDescription("Ported from alfredo.py. Music resolution: YouTube Music search → InnerTube device profiles → yt-dlp fallback.")
    .addFields(
      {
        name: "🎵 Music (YouTube Music — No Ads)",
        value: [
          `\`${p}playmusic <song (by Artist)>\` — play in your VC (YouTube/Spotify-style query or a YouTube URL)`,
          `\`${p}pausemusic\` / \`${p}resumemusic\` / \`${p}stopmusic\` — pause, resume, hard stop`,
          `\`${p}skip\` — skip current song (queue continues)`,
          `\`${p}queue\` / \`${p}music-now\` — see the queue / what's playing`,
          `\`${p}clearq\` / \`${p}music-leave\` — clear queue / leave VC`,
          `\`${p}lyrics <song>\` — lyrics for the current or given song`,
        ].join("\n"),
      },
      { name: "⚙️ Core", value: "`ping` `uptime` `botinfo` `serverinfo` `help`", inline: false },
      {
        name: "🧰 Server config (ported from alfredo.py)",
        value: "`prefix <new|reset>` • `afk <reason>` / `afk-clear` • `tag`/`createtag`/`edittag`/`deltag`/`tags` • `note`/`notes`/`delnote` • `remind <time> <text>`/`reminders`/`delreminder` • `addtodo`/`todo`/`donetodo`/`cleartodo` • `customcmd <trigger> <response>`/`customcmds`/`delcustomcmd`",
        inline: false,
      },
      {
        name: "🎲 Fun & games",
        value: "`8ball` `coinflip` `dice` `d20` `d6` `d100` `rps` `choose` `roll NdM` `poll` `joke` `fact` `quote` `reverse` `mock` `clap` • `truth` `dare` `compliment` `ship` `slots` `hug`/`pat`/`kiss`/`slap` `countdown` `dog` `cat` • counting game: `counting-set #ch` `counting-reset`",
        inline: false,
      },
      {
        name: "🧮 Text • math • encoding",
        value: "`boldtext` `codetext` `clapify` `emojify` `b64encode2`/`b64decode2` `base32` `binaryencode`/`binarydecode` `bin2dec`/`dec2bin`/`dec2hex`/`hex2dec` `caesar` `atbash` `charcount` • `average` `sqrt` `abs` `ceil` `floor` `round` `cos`/`sin`/`tan` `deg2rad`/`rad2deg` `divide` `sum` `max`/`min` `factorial` `gcd`/`lcm` `isprime` `percent`",
        inline: false,
      },
      {
        name: "💰 Economy & counting game",
        value: "`daily` `beg` `crime` `balance` `pay` `gamble` `rob` `shop` `buy` `inventory` `additem`/`delitem` (admin)",
        inline: false,
      },
      {
        name: "📊 Server info",
        value: "`channelinfo` `channelcount` `channellist` `channeltopic` `channelage` `roleinfo` `rolecount` `rolelist` `emojicount` `emojilist` `boost-info` `boosters`",
        inline: false,
      },
      {
        name: "🛠️ Utility",
        value: "`avatar` `userinfo` `servericon` `banner` `say` `calc <expr>` `qr <text>` `uuid`",
        inline: false,
      },
      {
        name: "🛡️ Moderation & automod",
        value: "`kick` `ban` `unban` `mute <time>` `unmute` `purge <n>` `slowmode <s>` • `warn` `warns` `delwarn` `clearwarn` • `case-list`/`case-view <id>` • `addrole`/`removerole` `setnick` `deafen`/`undeafen` `banlist` • toggles: `antilink` `antiinvite` `anticaps` `antihoist` `antiemoji` `antispam` `automodstatus`",
        inline: false,
      },
      {
        name: "🤖 Bot config (admin)",
        value: "`prefix <new|reset>` • `botstatus <online|idle|dnd|invisible>` • `botactivity <playing|watching|listening|streaming> <text>` • `botactivityclear` • `commandcount` — NO AI/Ollama commands, excluded by owner request",
        inline: false,
      },
    )
    .setFooter({ text: "Example: .playmusic chei sudahlah (by angga dermawan)" });
  await ctx.reply({ embeds: [embed] });
});

// ---------------------------------------------------------------------------
// MUSIC
// ---------------------------------------------------------------------------
command("playmusic", async (ctx) => {
  const music = ctx.music;
  const query = ctx.args.join(" ").trim();
  if (!query) {
    return ctx.reply(
      `🎵 Usage: \`.playmusic <song name> (by Artist)\`\nExample: \`.playmusic chei sudahlah (by angga dermawan)\`\n💡 Also accepts a YouTube link.`,
    );
  }
  if (/open\.spotify\.com/i.test(query)) {
    return ctx.reply("❌ Spotify links need Spotify API credentials, which this Node edition doesn't ship.\nPaste a song name (or a YouTube link) instead — e.g. `.playmusic <song> (by artist)`.");
  }
  const vc = ctx.voiceChannel;
  if (!vc) return ctx.reply("🎤 You must be in a voice channel first.");

  const guild = ctx.guild;
  const st = music.getState(guild.id, true);
  const busy = music.isBusy(guild.id);
  const handle = await ctx.reply(
    busy
      ? `🎵 **${st.queue.length + 1}.** Searching YouTube Music for: **${query}** ... (added to queue)`
      : `🔎 Searching YouTube Music for: **${query}** ...`,
  );

  // Direct URL input: skip search, fetch title via oEmbed.
  const videoId = extractVideoId(query);
  let cand;
  if (videoId) {
    let title = "YouTube audio";
    let artists = "YouTube";
    try {
      const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { signal: AbortSignal.timeout(8000) });
      if (oe.ok) {
        const j = await oe.json();
        title = j.title || title;
        artists = j.author_name || artists;
      }
    } catch {}
    cand = { videoId, title, artists, duration: 0, isVideo: true };
  } else {
    cand = await searchTrack(query);
    if (!cand) return ctx.edit(handle, `❌ No results found for: **${query}**`);
  }

  const watchUrl = `https://www.youtube.com/watch?v=${cand.videoId}`;
  const entry = {
    videoId: cand.videoId,
    title: cand.title,
    artists: cand.artists,
    duration: cand.duration,
    watchUrl,
    requestedBy: ctx.user.id,
    requestedByName: ctx.user.username,
    channel: ctx.channel,
  };

  if (busy) {
    st.queue.push(entry);
    const embed = new EmbedBuilder()
      .setColor(BLUE)
      .setTitle("🎵 Added to Queue")
      .setDescription(`**${entry.title}**\nby **${entry.artists}**`)
      .setURL(watchUrl)
      .addFields(
        { name: "Position", value: `#${st.queue.length}`, inline: true },
        { name: "Requested by", value: `<@${ctx.user.id}>`, inline: true },
      )
      .setFooter({ text: "Will play after the current song ends" });
    return ctx.edit(handle, { embeds: [embed] });
  }

  await ctx.edit(handle, `🎵 Now loading: **${entry.title}** by **${entry.artists}**\n🔗 ${watchUrl}`);
  try {
    await music.ensureVoice(vc, guild);
  } catch (e) {
    return ctx.edit(handle, `❌ Voice connection error: ${e.message}`);
  }
  await ctx.edit(handle, `🎵 Loading stream: **${entry.title}** by **${entry.artists}** ...`);
  try {
    await music.playEntry(guild, entry);
  } catch (e) {
    return ctx.edit(handle, `❌ ${e.message}`);
  }
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle("🎵 Now Playing")
    .setDescription(`**${entry.title}**\nby **${entry.artists}**`)
    .setURL(watchUrl)
    .addFields(
      { name: "Duration", value: entry.duration ? fmtDuration(entry.duration) : "live/unknown", inline: true },
      { name: "Requested by", value: `<@${ctx.user.id}>`, inline: true },
      { name: "Voice", value: `<#${vc.id}>`, inline: true },
    )
    .setFooter({ text: "No ads • Song stops at the end • Use .playmusic again for next" });
  await ctx.send({ embeds: [embed] });
});

command("pausemusic", async (ctx) => {
  const st = ctx.music.getState(ctx.guild.id);
  if (!st?.current || !st.player) return ctx.reply("Nothing is playing right now.");
  st.player.pause();
  await ctx.reply("⏸ Paused — use `.resumemusic` to continue.");
});

command("resumemusic", async (ctx) => {
  const st = ctx.music.getState(ctx.guild.id);
  if (!st?.current || !st.player) return ctx.reply("Nothing is paused right now.");
  st.player.unpause();
  await ctx.reply("▶️ Resumed.");
});

command("stopmusic", async (ctx) => {
  const st = ctx.music.getState(ctx.guild.id);
  if (!st) return ctx.reply("Not in a voice channel.");
  if (!st.current && !st.queue.length) return ctx.reply("Nothing is playing right now.");
  st.stopping = true;
  st.current = null;
  st.queue = [];
  try { st.player?.stop(true); } catch {}
  await ctx.reply("⏹ Hard stop — queue cleared. (`.music-leave` to kick me from the VC.)");
});

command("skip", async (ctx) => {
  const st = ctx.music.getState(ctx.guild.id);
  if (!st?.current) return ctx.reply("Nothing is playing right now.");
  const title = st.current.title;
  st.player?.stop(); // Idle handler auto-plays the next queued song
  await ctx.reply(`⏭ Skipped **${title}**.`);
});

command("queue", async (ctx) => {
  const st = ctx.music.getState(ctx.guild.id);
  if (!st?.current && !st?.queue.length) return ctx.reply("The queue is empty — use `.playmusic <song>` to start.");
  const lines = [];
  if (st.current) lines.push(`**▶️ Now:** [${st.current.title}](${st.current.watchUrl}) — ${st.current.artists}`);
  st.queue.forEach((e, i) => lines.push(`**${i + 1}.** [${e.title}](${e.watchUrl}) — ${e.artists} • <@${e.requestedBy}>`));
  const embed = new EmbedBuilder().setColor(BLUE).setTitle("🎵 Queue").setDescription(lines.slice(0, 15).join("\n"));
  if (lines.length > 15) embed.setFooter({ text: `+${lines.length - 15} more` });
  await ctx.reply({ embeds: [embed] });
});

command("music-now", async (ctx) => {
  const st = ctx.music.getState(ctx.guild.id);
  if (!st?.current) return ctx.reply("Nothing is playing right now.");
  const cur = st.current;
  const elapsed = st.startedAt ? (Date.now() - st.startedAt) / 1000 : 0;
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle("🎵 Now Playing")
    .setDescription(`**${cur.title}**\nby **${cur.artists}**`)
    .setURL(cur.watchUrl)
    .addFields(
      { name: "Progress", value: `${fmtDuration(elapsed)}${cur.duration ? ` / ${fmtDuration(cur.duration)}` : ""}`, inline: true },
      { name: "Requested by", value: `<@${cur.requestedBy}>`, inline: true },
      { name: "In queue", value: `${st.queue.length} song(s)`, inline: true },
    );
  await ctx.reply({ embeds: [embed] });
});

command("music-leave", async (ctx) => {
  const st = ctx.music.getState(ctx.guild.id);
  if (!st && !ctx.music.isBusy(ctx.guild.id)) {
    const conn = require("@discordjs/voice").getVoiceConnection(ctx.guild.id);
    if (!conn) return ctx.reply("Not in a voice channel.");
  }
  ctx.music.cleanup(ctx.guild.id, "music-leave");
  await ctx.reply("👋 Left the voice channel and cleared the queue.");
});

command("joinvc", async (ctx) => {
  if (!ctx.voiceChannel) return ctx.reply("🎤 You must be in a voice channel first.");
  try {
    await ctx.music.ensureVoice(ctx.voiceChannel, ctx.guild);
    await ctx.reply(`🎤 Joined **${ctx.voiceChannel.name}**.`);
  } catch (e) {
    await ctx.reply(`❌ Voice connection error: ${e.message}`);
  }
});

command("clearq", async (ctx) => {
  const st = ctx.music.getState(ctx.guild.id);
  const n = st?.queue.length || 0;
  if (st) st.queue = [];
  await ctx.reply(`🧹 Cleared ${n} song(s) from the queue.`);
});

command("lyrics", async (ctx) => {
  let query = ctx.args.join(" ").trim();
  const st = ctx.music.getState(ctx.guild.id);
  if (!query && st?.current) query = `${st.current.title} ${st.current.artists}`;
  if (!query) return ctx.reply("🎵 Give a song: `.lyrics <song (by artist)>` — or play one first.");
  const handle = await ctx.reply("🔎 Searching lyrics ...");
  const { song, artist } = parseSongQuery(query);
  try {
    const url = `https://lrclib.net/api/search?${new URLSearchParams(artist ? { track_name: song, artist_name: artist, limit: "5" } : { q: song, limit: "5" })}`;
    const resp = await fetch(url, { headers: { "User-Agent": "AlfredoBot/1.0 (discord bot)" }, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`lrclib HTTP ${resp.status}`);
    const rows = await resp.json();
    const hit = rows.find((r) => r.plainLyrics) || rows[0];
    if (!hit) return ctx.edit(handle, `❌ No lyrics found for **${song}**${artist ? ` by ${artist}` : ""}.`);
    let text = hit.plainLyrics || String(hit.syncedLyrics || "").replace(/\[\d+:\d+(\.\d+)?\]\s*/g, "").trim();
    if (!text) return ctx.edit(handle, `❌ No lyrics text for **${hit.trackName}**.`);
    if (text.length > 3900) text = `${text.slice(0, 3900)}\n... (truncated)`;
    const embed = new EmbedBuilder()
      .setColor(BLUE)
      .setTitle(`📝 ${hit.trackName}`)
      .setAuthor({ name: hit.artistName })
      .setDescription(text)
      .setFooter({ text: "via lrclib.net" });
    await ctx.edit(handle, { embeds: [embed] });
  } catch (e) {
    await ctx.edit(handle, `❌ Lyrics lookup failed: ${e.message}`);
  }
});

// ---------------------------------------------------------------------------
// FUN
// ---------------------------------------------------------------------------
const EIGHT_BALL = ["It is certain.", "It is decidedly so.", "Without a doubt.", "Yes — definitely.", "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.", "Yes.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.", "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."];

command("8ball", async (ctx) => {
  const q = ctx.args.join(" ");
  if (!q) return ctx.reply("🎱 Ask me a question: `.8ball will today be a good day?`");
  const answer = EIGHT_BALL[crypto.randomInt(EIGHT_BALL.length)];
  await ctx.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle("🎱 " + answer).setDescription(`> ${q}`)] });
});

command("coinflip", async (ctx) => {
  await ctx.reply(`🪙 ${crypto.randomInt(2) ? "**Heads!**" : "**Tails!**"}`);
});

command("dice", async (ctx) => {
  const sides = Number(ctx.args[0]) || 6;
  if (sides < 2 || sides > 1000) return ctx.reply("🎲 Sides must be 2–1000.");
  await ctx.reply(`🎲 You rolled a **${crypto.randomInt(sides) + 1}** (1–${sides}).`);
});

for (const [name, sides] of Object.entries({ d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 })) {
  command(name, async (ctx) => {
    await ctx.reply(`🎲 d${sides} → **${crypto.randomInt(sides) + 1}**`);
  });
}

command("roll", async (ctx) => {
  const m = (ctx.args.join(" ") || "1d20").match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return ctx.reply("🎲 Use dice notation: `.roll 2d20+3`");
  const count = Math.min(Number(m[1]) || 1, 20);
  const sides = Math.min(Number(m[2]), 1000);
  const mod = Number(m[3]) || 0;
  const rolls = Array.from({ length: count }, () => crypto.randomInt(sides) + 1);
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  await ctx.reply(`🎲 \`${count}d${sides}${m[3] || ""}\` → [${rolls.join(", ")}]${mod ? ` ${m[3]}` : ""} = **${total}**`);
});

command("rps", async (ctx) => {
  const choices = ["rock", "paper", "scissors"];
  const user = (ctx.args[0] || "").toLowerCase();
  if (!choices.includes(user)) return ctx.reply("✊✋✌️ Pick one: `.rps rock|paper|scissors`");
  const bot = choices[crypto.randomInt(3)];
  const win = { rock: "scissors", paper: "rock", scissors: "paper" };
  const result = user === bot ? "It's a **tie**!" : win[user] === bot ? "**You win!** 🎉" : "**I win!** 🤖";
  await ctx.reply(`You: ${user} • Me: ${bot} — ${result}`);
});

command("choose", async (ctx) => {
  const options = ctx.args.join(" ").split(/,|\bor\b/i).map((s) => s.trim()).filter(Boolean);
  if (options.length < 2) return ctx.reply("🤔 Give me options: `.choose pizza, sushi, tacos`");
  await ctx.reply(`🤔 I choose: **${options[crypto.randomInt(options.length)]}**`);
});

command("poll", async (ctx) => {
  const question = ctx.args.join(" ");
  if (!question) return ctx.reply("📊 Ask something: `.poll pineapple on pizza?`");
  const embed = new EmbedBuilder().setColor(BLUE).setTitle("📊 " + question).setFooter({ text: `Poll by ${ctx.user.username}` });
  const handle = await ctx.reply({ embeds: [embed] });
  for (const emoji of ["👍", "👎", "🤷"]) {
    try { await handle.react(emoji); } catch {}
  }
});

const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "I told my computer I needed a break — it said 'no problem, I'll go to sleep.'",
  "Why did the developer go broke? Because he used up all his cache.",
  "There are 10 types of people: those who understand binary and those who don't.",
  "A SQL query walks into a bar, approaches two tables and asks: 'may I join you?'",
];
command("joke", async (ctx) => {
  try {
    const resp = await fetch("https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,racist,sexist,religion,political&type=single,twopart", { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const j = await resp.json();
      const text = j.type === "twopart" ? `${j.setup}\n\n||${j.delivery}||` : j.joke;
      return ctx.reply(`😂 ${text}`);
    }
  } catch {}
  await ctx.reply(`😂 ${JOKES[crypto.randomInt(JOKES.length)]}`);
});

command("fact", async (ctx) => {
  try {
    const resp = await fetch("https://uselessfacts.jsph.org/api/v2/facts/random", { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const j = await resp.json();
      if (j?.text) return ctx.reply(`💡 ${j.text}`);
    }
  } catch {}
  await ctx.reply("💡 Fact servers are shy right now — try again in a moment.");
});

const QUOTES = [
  '"The best way to predict the future is to invent it." — Alan Kay',
  '"Simplicity is the ultimate sophistication." — Leonardo da Vinci',
  '"Talk is cheap. Show me the code." — Linus Torvalds',
  '"Any sufficiently advanced technology is indistinguishable from magic." — Arthur C. Clarke',
  '"First, solve the problem. Then, write the code." — John Johnson',
  '"Whether you think you can, or you think you can\'t — you\'re right." — Henry Ford',
];
command("quote", async (ctx) => {
  await ctx.reply(`📜 ${QUOTES[crypto.randomInt(QUOTES.length)]}`);
});

command("reverse", async (ctx) => {
  const text = ctx.args.join(" ");
  if (!text) return ctx.reply("🔁 Give me text: `.reverse hello`");
  await ctx.reply(`🔁 ${text.split("").reverse().join("")}`);
});

command("mock", async (ctx) => {
  const text = ctx.args.join(" ");
  if (!text) return ctx.reply("🧢 Give me text: `.mock hello there`");
  const mocked = text.split("").map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
  await ctx.reply(`🧢 ${mocked}`);
});

command("clap", async (ctx) => {
  const text = ctx.args.join(" ");
  if (!text) return ctx.reply("👏 Give me text: `.clap great job`");
  await ctx.reply(`👏 ${text.split(/\s+/).join(" 👏")} 👏`);
});

// ---------------------------------------------------------------------------
// UTILITY
// ---------------------------------------------------------------------------
command("avatar", async (ctx) => {
  const target = ctx.mentionedUser || ctx.user;
  const embed = new EmbedBuilder().setColor(BLUE).setTitle(`${target.username}'s avatar`).setImage(target.displayAvatarURL({ size: 1024 }));
  await ctx.reply({ embeds: [embed] });
});

command("userinfo", async (ctx) => {
  const target = ctx.mentionedUser || ctx.user;
  const member = ctx.guild.members.cache.get(target.id);
  const embed = new EmbedBuilder()
    .setColor(member?.displayColor || BLUE)
    .setTitle(`${target.username} (${target.tag})`)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "ID", value: target.id, inline: true },
      { name: "Account created", value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
      { name: "Bot?", value: target.bot ? "yes" : "no", inline: true },
    );
  if (member) {
    embed.addFields(
      { name: "Joined server", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "?", inline: true },
      { name: "Top role", value: member.roles.highest.name, inline: true },
      { name: "Roles", value: member.roles.cache.filter((r) => r.name !== "@everyone").map((r) => r.name).slice(0, 10).join(", ") || "none", inline: false },
    );
  }
  await ctx.reply({ embeds: [embed] });
});

command("servericon", async (ctx) => {
  const icon = ctx.guild.iconURL({ size: 1024 });
  if (!icon) return ctx.reply("This server has no icon.");
  await ctx.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`${ctx.guild.name} icon`).setImage(icon)] });
});

command("banner", async (ctx) => {
  await ctx.guild.fetch();
  const banner = ctx.guild.bannerURL({ size: 1024 });
  if (!banner) return ctx.reply("This server has no banner.");
  await ctx.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`${ctx.guild.name} banner`).setImage(banner)] });
});

command("say", async (ctx) => {
  const text = ctx.args.join(" ");
  if (!text) return ctx.reply("💬 `.say hello everyone`");
  await ctx.send({ content: text });
});

// Safe arithmetic — shunting-yard, no eval.
function calcExpr(input) {
  const tokens = input.match(/\d+\.?\d*|[()+\-*/%^]/g);
  if (!tokens || !/^[\d.+\-*/%^()\s]+$/.test(input)) throw new Error("only numbers and + - * / % ^ ( ) are allowed");
  const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
  const out = [];
  const ops = [];
  let prevType = null;
  for (let raw of tokens) {
    if (/^\d/.test(raw)) {
      out.push(Number(raw));
      prevType = "num";
    } else if (raw === "(") {
      ops.push(raw);
      prevType = "(";
    } else if (raw === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop());
      if (!ops.length) throw new Error("unbalanced parentheses");
      ops.pop();
      prevType = "num";
    } else {
      if (raw === "-" && (prevType === null || prevType === "op" || prevType === "(")) {
        out.push(0); // unary minus → binary 0-x
      } else if (prevType === null || prevType === "op" || prevType === "(") {
        throw new Error("unexpected operator");
      }
      while (ops.length && ops[ops.length - 1] !== "(" && prec[ops[ops.length - 1]] >= prec[raw] && raw !== "^") out.push(ops.pop());
      ops.push(raw);
      prevType = "op";
    }
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === "(") throw new Error("unbalanced parentheses");
    out.push(op);
  }
  const st = [];
  for (const t of out) {
    if (typeof t === "number") st.push(t);
    else {
      const b = st.pop(), a = st.pop();
      if (a === undefined || b === undefined) throw new Error("malformed expression");
      st.push(t === "+" ? a + b : t === "-" ? a - b : t === "*" ? a * b : t === "/" ? a / b : t === "%" ? a % b : Math.pow(a, b));
    }
  }
  const result = st.pop();
  if (st.length || result === undefined || !Number.isFinite(result)) throw new Error("malformed expression");
  return result;
}

command("calc", async (ctx) => {
  const expr = ctx.args.join(" ");
  if (!expr) return ctx.reply("🧮 `.calc (2+3)*4^2`");
  try {
    const r = calcExpr(expr);
    await ctx.reply(`🧮 \`${expr}\` = **${r}**`);
  } catch (e) {
    await ctx.reply(`❌ ${e.message}`);
  }
});

command("qr", async (ctx) => {
  const text = ctx.args.join(" ");
  if (!text) return ctx.reply("📱 `.qr https://example.com`");
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text.slice(0, 900))}`;
  await ctx.reply({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle("QR code").setImage(url)] });
});

command("uuid", async (ctx) => {
  await ctx.reply(`🆔 \`${crypto.randomUUID()}\``);
});

// ---------------------------------------------------------------------------
// MODERATION
// ---------------------------------------------------------------------------
function parseDurationMs(text) {
  const m = String(text || "").trim().match(/^(\d+)(s|m|h|d)?$/i);
  if (!m) return null;
  const unit = (m[2] || "m").toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return Number(m[1]) * mult;
}

command("kick", async (ctx) => {
  requirePerms(ctx, PermissionFlagsBits.KickMembers, "Kick Members");
  const target = await resolveTarget(ctx);
  if (!target) return ctx.reply("Usage: `.kick @user [reason]`");
  const reason = ctx.args.slice(1).join(" ") || "No reason given";
  await ctx.guild.members.kick(target.id, `${reason} — by ${ctx.user.tag}`);
  await ctx.reply(`👢 Kicked **${target.tag}** — ${reason}`);
});

command("ban", async (ctx) => {
  requirePerms(ctx, PermissionFlagsBits.BanMembers, "Ban Members");
  const target = await resolveTarget(ctx);
  if (!target) return ctx.reply("Usage: `.ban @user [reason]`");
  const reason = ctx.args.slice(1).join(" ") || "No reason given";
  await ctx.guild.members.ban(target.id, { reason: `${reason} — by ${ctx.user.tag}` });
  await ctx.reply(`🔨 Banned **${target.tag}** — ${reason}`);
});

command("unban", async (ctx) => {
  requirePerms(ctx, PermissionFlagsBits.BanMembers, "Ban Members");
  const id = (ctx.args[0] || "").replace(/\D/g, "");
  if (!id) return ctx.reply("Usage: `.unban <user id>`");
  await ctx.guild.bans.remove(id, `unbanned by ${ctx.user.tag}`).catch(() => {
    throw new Error("That user doesn't look banned (or the ID is wrong).");
  });
  await ctx.reply(`🔓 Unbanned <@${id}>.`);
});

command("mute", async (ctx) => {
  requirePerms(ctx, PermissionFlagsBits.ModerateMembers, "Timeout Members");
  const target = (ctx.mentionedUser && ctx.guild.members.cache.get(ctx.mentionedUser.id)) || null;
  if (!target) return ctx.reply("Usage: `.mute @user 10m [reason]` (s/m/h/d)");
  const ms = parseDurationMs(ctx.args[1] || "10m");
  if (!ms || ms > 28 * 86400000) return ctx.reply("⏱️ Duration like `30s`, `10m`, `2h`, `1d` (max 28d).");
  const reason = ctx.args.slice(2).join(" ") || "No reason given";
  await target.timeout(ms, `${reason} — by ${ctx.user.tag}`);
  await ctx.reply(`🔇 Timed out **${target.user.tag}** for ${ctx.args[1] || "10m"} — ${reason}`);
});

command("unmute", async (ctx) => {
  requirePerms(ctx, PermissionFlagsBits.ModerateMembers, "Timeout Members");
  const target = (ctx.mentionedUser && ctx.guild.members.cache.get(ctx.mentionedUser.id)) || null;
  if (!target) return ctx.reply("Usage: `.unmute @user`");
  await target.timeout(null, `unmuted by ${ctx.user.tag}`);
  await ctx.reply(`🔊 Unmuted **${target.user.tag}**.`);
});

command("purge", async (ctx) => {
  requirePerms(ctx, PermissionFlagsBits.ManageMessages, "Manage Messages");
  const n = Math.min(Number(ctx.args[0]) || 0, 100);
  if (n < 1) return ctx.reply("Usage: `.purge 25` (1–100, younger than 14 days)");
  const deleted = await ctx.channel.bulkDelete(n, true);
  const notice = await ctx.reply(`🧹 Deleted ${deleted.size} message(s).`);
  setTimeout(() => notice.delete().catch(() => {}), 3000);
});

command("slowmode", async (ctx) => {
  requirePerms(ctx, PermissionFlagsBits.ManageChannels, "Manage Channels");
  if (!ctx.channel.isTextBased() || ctx.channel.type === ChannelType.GuildStageVoice) return ctx.reply("Can't set slowmode here.");
  const seconds = Number(ctx.args[0]);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) return ctx.reply("Usage: `.slowmode 30` (0–21600 seconds)");
  await ctx.channel.setRateLimitPerUser(seconds, `slowmode set by ${ctx.user.tag}`);
  await ctx.reply(seconds === 0 ? "⚡ Slowmode disabled." : `🐢 Slowmode set to ${seconds}s.`);
});

async function resolveTarget(ctx) {
  if (ctx.mentionedUser) return ctx.mentionedUser;
  const id = (ctx.args[0] || "").replace(/\D/g, "");
  if (!id) return null;
  try {
    return await ctx.client.users.fetch(id);
  } catch {
    return null;
  }
}

module.exports = { registry, ALIASES, calcExpr };
