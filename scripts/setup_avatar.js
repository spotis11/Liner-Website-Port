// One-time (or re-runnable) Discord profile setup for the Liner System bot:
// sets the bot avatar to the official Liner icon and the username to "Liner System".
// Uses only Node's global fetch — never prints the token.
const fs = require('fs');
const path = require('path');

const envFile = '/home/z/my-project/liner-bot/.env';
const avatarFile = '/home/z/my-project/liner-bot/assets/avatar.png';
const API = 'https://discord.com/api/v10';

function getToken() {
  const line = fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('DISCORD_TOKEN='));
  if (!line) throw new Error('DISCORD_TOKEN not found in .env');
  return line.slice('DISCORD_TOKEN='.length).trim();
}

async function main() {
  const token = getToken();
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };

  const me = await fetch(`${API}/users/@me`, { headers });
  if (!me.ok) { console.error('token check failed:', me.status, await me.text()); process.exit(1); }
  const meJson = await me.json();
  console.log('current bot identity:', `${meJson.username}#${meJson.discriminator || '0'}`, 'id:', meJson.id);

  const b64 = fs.readFileSync(avatarFile).toString('base64');
  const patchBody = { avatar: `data:image/png;base64,${b64}` };
  if (meJson.username !== 'Liner System') patchBody.username = 'Liner System';

  const patched = await fetch(`${API}/users/@me`, { method: 'PATCH', headers, body: JSON.stringify(patchBody) });
  if (!patched.ok) {
    const err = await patched.text();
    // username changes are rate-limited (2/h) — avatar is what matters most
    if (patchBody.username && patched.status === 429) {
      console.error('avatar+username update rate-limited, retrying avatar only...');
      const retry = await fetch(`${API}/users/@me`, { method: 'PATCH', headers, body: JSON.stringify({ avatar: patchBody.avatar }) });
      console.log('avatar-only retry:', retry.status, retry.ok ? 'OK' : await retry.text());
    } else {
      console.error('profile update failed:', patched.status, err);
      process.exit(1);
    }
  } else {
    const j = await patched.json();
    console.log('profile updated: username:', j.username, 'avatar set:', Boolean(j.avatar));
  }
  console.log('done');
}

main().catch((e) => { console.error(e); process.exit(1); });
