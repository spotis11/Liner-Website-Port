// One-time visual verification: posts the current origin/main HEAD commit as a
// GitHub-style embed (identical construction to the watcher's embed) so the
// layout can be confirmed against the reference screenshot.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, Events,
} = require('/home/z/my-project/liner-bot/node_modules/discord.js');

const BOT_DIR = '/home/z/my-project/liner-bot';
const token = fs.readFileSync(path.join(BOT_DIR, '.env'), 'utf8').match(/DISCORD_TOKEN=(.*)/)[1].trim();
const FIELD = '\x1f';

function git(args) {
  return new Promise((resolve) => {
    const c = spawn('git', args, { cwd: '/home/z/my-project', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('close', () => resolve({ out, err }));
  });
}

function authorAvatarUrl(name, email) {
  let m = /(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com/i.exec(email || '');
  if (m) return `https://github.com/${m[1]}.png`;
  return `https://github.com/${(name || 'github').toLowerCase().replace(/[^a-z0-9-]/g, '-')}.png`;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  try {
    const guild = client.guilds.cache.first();
    await guild.channels.fetch();
    const ch = guild.channels.cache.filter((c) => c && c.type === ChannelType.GuildText).find((c) => c.name && c.name.includes('git-logs'))
      || guild.systemChannel;
    if (!ch) throw new Error('no channel');

    const log = await git(['log', '-n', '1', `--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s`, 'origin/main']);
    const [H, h, an, ae, aI, s] = log.out.trim().split(FIELD);
    const avatar = authorAvatarUrl(an, ae);

    const embed = new EmbedBuilder()
      .setColor(0xffffff)
      .setTitle(`[main] 1 new commit`)
      .setDescription(`\`${h}\` ${(s || '').replace(/`/g, "'")} - *${an}*`)
      .setFooter({ iconURL: 'attachment://githubmark.png', text: `GitHub · spotis11/Liner-Website-Port` })
      .setTimestamp(new Date(aI))
      .setThumbnail(avatar);

    const files = [new AttachmentBuilder(path.join(BOT_DIR, 'assets/githubmark.png'), { name: 'githubmark.png' })];
    const rows = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Open on GitHub').setStyle(ButtonStyle.Link).setURL(`https://github.com/spotis11/Liner-Website-Port/commit/${H}`),
    )];
    const msg = await ch.send({ embeds: [embed], components: rows, files });
    console.log('verification embed sent to #' + ch.name, 'message id:', msg.id);
    console.log('commit:', h, '| author:', an, '| avatar:', avatar);
  } catch (e) {
    console.error('verification failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.destroy();
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
});

client.login(token).catch((e) => { console.error('login failed:', e.message); process.exit(1); });
