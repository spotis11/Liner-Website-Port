// End-to-end: parse REAL git log output through the bot's exact pipeline.
'use strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GIT_COMMIT_FORMAT, RECORD_SEP, parseCommitLine } from '../liner-bot/commits.js';

const run = promisify(execFile);
const { stdout } = await run('git', ['log', '-5', `--format=${GIT_COMMIT_FORMAT}`], {
  cwd: '/home/z/my-project', maxBuffer: 10 * 1024 * 1024,
});
const parsed = stdout
  .split(RECORD_SEP)
  .map((r) => r.trim())
  .filter(Boolean)
  .map(parseCommitLine)
  .filter(Boolean);
console.log(`parsed ${parsed.length} real commits:`);
for (const c of parsed) {
  console.log(`  ${c.short}  ${c.subject}  → *${c.author}*${c.isClaude ? '  [claude trailer]' : ''}`);
}
const ok = parsed.length === 5 && parsed.every((c) => c.full && c.subject && c.date && c.author);
console.log(ok ? 'END-TO-END OK' : 'END-TO-END MISMATCH');
process.exit(ok ? 0 : 1);
