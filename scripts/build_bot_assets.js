// Build image assets for the Liner System Discord bot (pure Node + sharp, no Python).
// 1) bot avatar: official Liner app icon (matches the screenshot avatar mark)
// 2) footer icon: blue rounded square with white "<>" glyph (like the screenshot footer)
// 3) sample embed accent color from the screenshot's left strip
const path = require('path');
const fs = require('fs');
const sharp = require('/home/z/my-project/liner-bot/node_modules/sharp');

const SHOT = '/home/z/my-project/upload/pasted_image_1794556947088.png';
const OUT = '/home/z/my-project/liner-bot/assets';
fs.mkdirSync(OUT, { recursive: true });

async function sampleColor(left, top, size = 2) {
  const buf = await sharp(SHOT)
    .extract({ left, top, width: size, height: size })
    .removeAlpha()
    .raw()
    .toBuffer();
  let r = 0, g = 0, b = 0, n = size * size;
  for (let i = 0; i < buf.length; i += 3) { r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; }
  const hex = '#' + [r / n, g / n, b / n].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  return hex;
}

async function main() {
  // 1) avatar
  await sharp('/home/z/my-project/liner-app/build/icons/512x512.png')
    .png()
    .toFile(path.join(OUT, 'avatar.png'));
  console.log('avatar.png written (official Liner icon)');

  // 2) sample colors from the screenshot at several candidate points
  const probes = [];
  for (const x of [69, 70, 71, 72, 73]) for (const y of [60, 100, 150]) probes.push(['strip', x, y]);
  for (const x of [84, 88, 92, 96, 100]) for (const y of [142, 148, 154]) probes.push(['icon', x, y]);
  for (const [label, x, y] of probes) {
    const hex = await sampleColor(x, y);
    console.log(label, `${x},${y}`, hex);
  }

  // 3) footer icon: blue rounded square + white <> chevrons
  // pick the most "blue" sample from the icon probes (max b - r)
  let best = null;
  for (const [label, x, y] of probes) {
    if (label !== 'icon') continue;
    // re-sample and parse
    const hex = await sampleColor(x, y);
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const score = b - r;
    if (!best || score > best.score) best = { hex, score, at: `${x},${y}` };
  }
  const blue = best && best.score > 20 ? best.hex : '#4183c4';
  console.log('chosen icon blue:', blue, 'from', best ? best.at : 'fallback');
  const svg = `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="14" fill="${blue}"/>
  <polyline points="26,22 14,32 26,42" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="38,22 50,32 38,42" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, 'githubmark.png'));
  console.log('githubmark.png written');

  for (const f of ['avatar.png', 'githubmark.png']) {
    const st = fs.statSync(path.join(OUT, f));
    console.log(f, st.size, 'bytes');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
