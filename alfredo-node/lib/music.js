// Alfredo music player — Node edition (@discordjs/voice).
// Mirrors alfredo.py's behavior: self-deaf join, stream straight from the
// YouTube CDN (no download), ffmpeg auto-reconnect flags, per-guild queue,
// "Song Finished"/"Playback Ended Early" notices.
"use strict";

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");
const prism = require("prism-media");
const { EmbedBuilder } = require("discord.js");
const { resolveStream } = require("./innertube");

const GREEN = 0x57f287;
const BLUE = 0x5865f2;
const ORANGE = 0xe67e22;
const RED = 0xed4245;

function log(...parts) {
  console.log(`[music] ${new Date().toISOString()}`, ...parts);
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

class MusicManager {
  constructor(client) {
    this.client = client;
    // guildId → { queue, current, connection, player, channel, startedAt, stopping, notifiedEnd }
    this.state = new Map();
  }

  getState(guildId, create = false) {
    if (!this.state.has(guildId) && create) {
      this.state.set(guildId, { queue: [], current: null });
    }
    return this.state.get(guildId);
  }

  async ensureVoice(channel, guild) {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let connection = getVoiceConnection(guild.id);
      if (connection && connection.joinConfig.channelId === channel.id) return connection;
      if (connection) {
        try { connection.destroy(); } catch {}
      }
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true, // CRITICAL for music bots: deafened = no inbound voice data
        selfMute: false,
      });
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await entersState(connection, VoiceConnectionStatus.Signalling, 5000);
        } catch {
          // real disconnect — clean up like Python's disconnected handler
          this.cleanup(guild.id, "voice connection lost");
        }
      });
      try {
        // cold containers often miss the first UDP handshake — retry instead of aborting
        await entersState(connection, VoiceConnectionStatus.Ready, 25000);
        connection.on(VoiceConnectionStatus.Destroyed, () => this.cleanup(guild.id, "voice connection destroyed"));
        const st = this.getState(guild.id, true);
        st.connection = connection;
        if (st.player) st.connection.subscribe(st.player);
        return connection;
      } catch (e) {
        lastErr = e;
        log(`voice join attempt ${attempt}/3 for guild=${guild.id} failed: ${e.message}`);
        try { connection.destroy(); } catch {}
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw new Error(`voice connection failed after 3 attempts (${lastErr?.message || "unknown"}) — try again in a minute`);
  }

  ensurePlayer(guildId, channel) {
    const st = this.getState(guildId, true);
    if (st.player) return st.player;
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    player.on(AudioPlayerStatus.Idle, () => this.onIdle(guildId));
    player.on("error", (err) => {
      log(`player error guild=${guildId}:`, err.message);
      this.onIdle(guildId, err.message);
    });
    st.player = player;
    st.channel = channel;
    if (st.connection) st.connection.subscribe(player);
    return player;
  }

  buildResource(stream) {
    // googlevideo closes idle sockets: pass ffmpeg the same reconnect flags
    // (and the same User-Agent the resolver probed with) as alfredo.py did.
    const args = [
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "10",
      "-user_agent", stream.userAgent,
      "-analyzeduration", "0",
      "-loglevel", "0",
      "-i", stream.url,
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
    ];
    const ffmpeg = new prism.FFmpeg({ args });
    ffmpeg.on("error", (e) => log("ffmpeg:", e.message));
    return createAudioResource(ffmpeg, { inputType: StreamType.Raw, inlineVolume: true });
  }

  async playEntry(guild, entry) {
    const st = this.getState(guild.id, true);
    const player = this.ensurePlayer(guild.id, entry.channel);
    const stream = entry.stream || (await resolveStream(entry.watchUrl, `${entry.title} ${entry.artists}`));
    if (!stream) throw new Error("Could not extract a stream URL from YouTube. The video may be region-locked or age-restricted.");
    entry.stream = stream;
    st.current = entry;
    st.startedAt = Date.now();
    st.stopping = false;
    st.notifiedEnd = false;
    player.play(this.buildResource(stream));
    await entersState(player, AudioPlayerStatus.Playing, 20000);
  }

  onIdle(guildId, errMsg) {
    const st = this.state.get(guildId);
    if (!st) return;
    const finished = st.current;
    st.current = null;
    if (!finished || st.stopping) return;
    const elapsed = st.startedAt ? (Date.now() - st.startedAt) / 1000 : 0;
    log(`idle guild=${guildId} title=${JSON.stringify(finished.title)} elapsed=${elapsed.toFixed(0)}s err=${errMsg || "none"}`);
    const channel = st.channel;
    const next = st.queue.shift();
    if (next) {
      this.playEntry({ id: guildId, ...{} }, next).catch((e) => {
        log("auto-play next failed:", e.message);
        channel?.send(`⚠️ Auto-play failed: ${e.message}`).catch(() => {});
      });
      channel?.send({
        embeds: [new EmbedBuilder().setColor(BLUE).setTitle("🎵 Now Playing").setDescription(`**${next.title}**\nby **${next.artists}**`).addFields(
          { name: "Duration", value: fmtDuration(next.duration), inline: true },
          { name: "Requested by", value: `<@${next.requestedBy}>`, inline: true },
        )],
      }).catch(() => {});
      return;
    }
    if (st.notifiedEnd) return;
    st.notifiedEnd = true;
    const early = elapsed < 5 && !errMsg;
    const embed = new EmbedBuilder()
      .setColor(early || errMsg ? ORANGE : GREEN)
      .setTitle(errMsg ? "⚠️ Playback Error" : early ? "⚠️ Playback Ended Early" : "🎵 Song Finished")
      .setDescription(
        errMsg
          ? `**${finished.title}** — ${errMsg}\nTry \`.playmusic\` again.`
          : early
            ? `**${finished.title}** by **${finished.artists}** stopped after ${elapsed.toFixed(0)}s — the stream may have failed. Try \`.playmusic\` again.`
            : `**${finished.title}** by **${finished.artists}** has ended.\nUse \`.playmusic <song>\` to play another.`,
      );
    channel?.send({ embeds: [embed] }).catch(() => {});
  }

  cleanup(guildId, reason) {
    const st = this.state.get(guildId);
    if (!st) return;
    log(`cleanup guild=${guildId}: ${reason}`);
    try { st.player?.stop(true); } catch {}
    try { st.connection?.destroy(); } catch {}
    this.state.delete(guildId);
  }

  isBusy(guildId) {
    const st = this.state.get(guildId);
    return Boolean(st?.current);
  }
}

module.exports = { MusicManager, fmtDuration, COLORS: { GREEN, BLUE, ORANGE, RED } };
