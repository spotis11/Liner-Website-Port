#!/bin/bash
# Three-way merge: upstream v0.2.10 (base) -> v0.2.11 (theirs) onto the port's
# liner-app/ (ours). Port-only files stay; upstream deletions are applied when
# the port didn't modify the file; conflicting hunks keep OURS and get logged.
set -u
BASE=/tmp/lr10
THEIRS=/tmp/lr11
OURS=/home/z/my-project/liner-app
LOG=/tmp/merge-log.txt
CONFLICTS=/tmp/merge-conflicts.txt
: > "$LOG"; : > "$CONFLICTS"

# upstream repo-meta paths the web port does not need
skip_path() {
  case "$1" in
    .github/*|.github|docs/*|docs|signer|pnpm-lock.yaml) return 0 ;;
    *) return 1 ;;
  esac
}

cd /home/z/my-project || exit 1

# ---- 1. add / update everything upstream v0.2.11 ships -----------------------
(cd "$THEIRS" && find . -type f | sed 's|^\./||' | sort) | while IFS= read -r P; do
  skip_path "$P" && continue
  T="$THEIRS/$P"; O="$OURS/$P"; B="$BASE/$P"

  if [ ! -f "$O" ]; then
    # new upstream file (or previously deleted by port): take theirs
    mkdir -p "$(dirname "$O")"
    cp "$T" "$O"
    echo "ADD    $P" >> "$LOG"
    continue
  fi

  if [ -f "$B" ] && cmp -s "$O" "$B"; then
    cp "$T" "$O"
    echo "UPDATE $P" >> "$LOG"
    continue
  fi

  if [ ! -f "$B" ]; then
    # upstream new file but port also has a file there -> port wins, log it
    echo "KEEP-PORT(new) $P" >> "$LOG"
    continue
  fi

  if cmp -s "$T" "$B"; then
    echo "KEEP-PORT(upstream-unchanged) $P" >> "$LOG"
    continue
  fi

  # real three-way merge
  TMPDIR_M=$(mktemp -d)
  cp "$O" "$TMPDIR_M/ours"
  cp "$B" "$TMPDIR_M/base"
  cp "$T" "$TMPDIR_M/theirs"
  if git merge-file -L ours -L base -L theirs \
      "$TMPDIR_M/ours" "$TMPDIR_M/base" "$TMPDIR_M/theirs" > /dev/null 2>&1; then
    cp "$TMPDIR_M/ours" "$O"
    echo "MERGED $P" >> "$LOG"
  else
    N=$(grep -c '^<<<<<<<' "$TMPDIR_M/ours" || true)
    cp "$TMPDIR_M/ours" "$O.conflict"
    echo "$P|$N" >> "$CONFLICTS"
    echo "CONFLICT($N) $P" >> "$LOG"
  fi
  rm -rf "$TMPDIR_M"
done

# ---- 2. upstream deletions: in base, gone in theirs, port unmodified --------
(cd "$BASE" && find . -type f | sed 's|^\./||' | sort) | while IFS= read -r P; do
  skip_path "$P" && continue
  [ -f "$THEIRS/$P" ] && continue
  O="$OURS/$P"
  [ -f "$O" ] || continue
  if cmp -s "$O" "$BASE/$P"; then
    rm -f "$O"
    echo "DELETE $P" >> "$LOG"
  else
    echo "KEEP-PORT(upstream-deleted) $P" >> "$LOG"
  fi
done

echo "---- conflicts ----"
cat "$CONFLICTS"
