'use strict';
// Commit parsing + attribution shared by the watcher (index.js) and the
// verification script (scripts/test_commit_attribution.js).

const FIELD = "\x1f";
// %b (body) is captured so a "Co-Authored-By: Claude <noreply@anthropic.com>"
// trailer can attribute agent-made commits to Claude. The sandbox signs its
// commits with the checkout owner's git identity, so without the trailer the
// embed painted every agent commit with the repo owner's name and avatar.
const GIT_COMMIT_FORMAT = "%H%x1f%h%x1f%s%x1f%ae%x1f%an%x1f%aI%x1f%b";

// Verified against api.github.com/orgs/anthropics (200, image/png).
// Override with CLAUDE_AVATAR_URL if it ever moves.
const CLAUDE_AVATAR_URL =
  process.env.CLAUDE_AVATAR_URL || "https://avatars.githubusercontent.com/u/76263028?v=4";

// A commit is Claude's when its message carries the Co-Authored-By trailer
// (name mentions claude or the anthropic noreply email) or the
// "Generated with Claude" footnote some agents append.
const CLAUDE_TRAILER_RE =
  /co-authored-by:[^\n]*(claude|noreply@anthropic\.com)|generated with \[?claude/i;

function isClaudeCommit(commit) {
  const text = `${commit?.subject || ""}\n${commit?.body || ""}`;
  return CLAUDE_TRAILER_RE.test(text);
}

function githubAuthorFromNoreply(email) {
  const m = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email || "");
  return m ? m[1] : null;
}

// parseCommitLine splits one `git log --format=$GIT_COMMIT_FORMAT` record.
// The displayed author is the GitHub login behind the noreply email;
// Claude-co-authored commits are attributed to Claude.
function parseCommitLine(line) {
  const [full, short, subject, email, name, date, body = ""] = line.split(FIELD);
  const claude = isClaudeCommit({ subject, body });
  const gh = githubAuthorFromNoreply(email);
  return {
    full, short, subject, email, name, date, body,
    isClaude: claude,
    author: claude ? "Claude" : gh || name || email,
  };
}

// Avatar for a human commit: the GitHub profile image of the noreply login,
// else a name-slug guess — the caller applies the static fallback.
function avatarForAuthor(name, email) {
  const gh = githubAuthorFromNoreply(email);
  if (gh) return `https://github.com/${gh}.png`;
  const slug = (name || "github")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "github";
  return `https://github.com/${slug}.png`;
}

// Live avatar for a commit, like the reference bot: GitHub's commits API
// returns the image of the account that actually owns the commit (so a
// pusher and an author get their own pictures). Claude commits get the
// Anthropic mark instead. Cached per sha for the process lifetime.
const _avatarCache = new Map(); // sha -> url
async function fetchCommitAvatar(label, commit, { fetchImpl = fetch } = {}) {
  if (!commit) return null;
  if (commit.isClaude) return CLAUDE_AVATAR_URL;
  if (_avatarCache.has(commit.full)) return _avatarCache.get(commit.full);
  const fallback = avatarForAuthor(commit.name, commit.email);
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${label}/commits/${commit.full}`,
      {
        headers: { "User-Agent": "liner-bot", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.ok) {
      const json = await res.json();
      const url = json?.author?.avatar_url || json?.committer?.avatar_url || null;
      if (url) _avatarCache.set(commit.full, url);
      return url || fallback;
    }
  } catch {
    /* offline or rate-limited — fall through to the noreply profile png */
  }
  return fallback;
}

export {
  FIELD,
  GIT_COMMIT_FORMAT,
  CLAUDE_AVATAR_URL,
  isClaudeCommit,
  parseCommitLine,
  avatarForAuthor,
  fetchCommitAvatar,
};
