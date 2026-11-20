// Attribution logic verification for liner-bot/commits.js — pure asserts plus
// one live GitHub API call. Run: node scripts/test_commit_attribution.mjs
'use strict';
import {
  GIT_COMMIT_FORMAT,
  CLAUDE_AVATAR_URL,
  parseCommitLine,
  avatarForAuthor,
  fetchCommitAvatar,
} from '../liner-bot/commits.js';

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failed++;
}

const F = '\x1f';
const mk = (subject, body = '') =>
  ['abc1234def', 'abc1234', subject, '244527415+spotis11@users.noreply.github.com',
   'spotis11', '2026-11-20T06:02:13Z', body].join(F);

// 1. plain commit → author is the GitHub login behind the noreply email
const plain = parseCommitLine(mk('fix(bot): something'));
check('plain: author=spotis11', plain.author === 'spotis11', plain.author);
check('plain: not claude', plain.isClaude === false);
check('plain: body captured', plain.body === '');

// 2. Claude co-author trailer (email form Claude Code writes)
const claude1 = parseCommitLine(mk('feat(bot): agent commit',
  'why\n\nCo-Authored-By: Claude <noreply@anthropic.com>'));
check('trailer email: author=Claude', claude1.author === 'Claude', claude1.author);
check('trailer email: isClaude', claude1.isClaude === true);

// 3. Claude co-author trailer (name form)
const claude2 = parseCommitLine(mk('feat(bot): agent commit 2',
  'Co-Authored-By: Claude <claude@anthropic.com>'));
check('trailer name: isClaude', claude2.isClaude === true, claude2.author);

// 4. "Generated with [Claude Code]" footnote
const claude3 = parseCommitLine(mk('chore: x', '🤖 Generated with [Claude Code]'));
check('footnote: isClaude', claude3.isClaude === true);

// 5. a human named Claude-something in the SUBJECT must NOT trip detection
const notClaude = parseCommitLine(mk('claude monet style filter'));
check('subject-only mention: not claude', notClaude.isClaude === false);

// 6. avatar fallback chain without network
check('claude avatar = anthropic mark',
  (await fetchCommitAvatar('o/r', claude1)) === CLAUDE_AVATAR_URL);
check('human fallback = noreply png',
  (await fetchCommitAvatar('o/r', plain, { fetchImpl: async () => ({ ok: false }) }))
    === 'https://github.com/spotis11.png');
check('no noreply → name slug fallback',
  avatarForAuthor('Ada L.', 'ada@example.com') === 'https://github.com/ada-l.png');

// 7. stubbed API success path
const apiAvatar = 'https://avatars.githubusercontent.com/u/999?v=4';
const viaApi = await fetchCommitAvatar('o/r', plain, {
  fetchImpl: async () => ({ ok: true, json: async () => ({ author: { avatar_url: apiAvatar } }) }),
});
check('api avatar used when present', viaApi === apiAvatar, viaApi);

// 8. LIVE: real GitHub API for a real commit on the watched repo
//    (fresh sha so the stubbed cache from check 7 can't mask the live call)
const liveCommit = { ...plain, full: '124cbe22c969a0ad18aa8891afe47319d6747f5b' };
const live = await fetchCommitAvatar('spotis11/Liner-Website-Port', liveCommit).catch((e) => `error: ${e.message}`);
check('live api avatar resolves', typeof live === 'string' && live.startsWith('https://'), String(live));
console.log('      live avatar:', live);

console.log(failed ? `\n${failed} check(s) FAILED` : `\nall checks passed (${GIT_COMMIT_FORMAT.includes('%b') ? 'format has %b' : 'FORMAT MISSING %b'})`);
process.exit(failed ? 1 : 0);
