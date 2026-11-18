"""Print or resolve git conflict hunks in a file.

Usage:
  python3 ../scripts/conflicts.py show <file>     # print numbered hunks
  python3 ../scripts/conflicts.py resolve <file> ours theirs ours ...   # one choice per hunk
  python3 ../scripts/conflicts.py resolve <file> --keep <file>  # no-op sanity (markers must be gone)
"""
import sys
import re

HUNK = re.compile(r"^<{7}( [^\n]*)?\n(.*?)^={7}\n(.*?)^>{7}.*?\n", re.S | re.M)


def split_hunks(text):
    """Return list of (start, end, ours, theirs) hunks."""
    out = []
    for m in HUNK.finditer(text):
        ours = m.group(2)
        theirs = m.group(3)
        out.append((m.start(), m.end(), ours, theirs))
    return out


def show(path):
    text = open(path, encoding="utf-8").read()
    hunks = split_hunks(text)
    print(f"{path}: {len(hunks)} conflict hunks")
    for i, (s, e, ours, theirs) in enumerate(hunks):
        line = text.count("\n", 0, s) + 1
        print(f"--- hunk {i} (line {line}) OURS: ---")
        print("\n".join(ours.splitlines()[:40]))
        print(f"--- hunk {i} THEIRS: ---")
        print("\n".join(theirs.splitlines()[:40]))
        print()


def resolve(path, choices):
    text = open(path, encoding="utf-8").read()
    hunks = split_hunks(text)
    assert len(choices) == len(hunks), f"{len(choices)} choices for {len(hunks)} hunks"
    result = []
    pos = 0
    for (s, e, ours, theirs), choice in zip(hunks, choices):
        result.append(text[pos:s])
        if choice == "ours":
            result.append(ours)
        elif choice == "theirs":
            result.append(theirs)
        elif choice == "both":
            result.append(ours + theirs)
        else:
            raise SystemExit(f"bad choice {choice}")
        pos = e
    result.append(text[pos:])
    out = "".join(result)
    assert "<<<<<<<" not in out, "markers remain"
    open(path, "w", encoding="utf-8").write(out)
    print(f"resolved {path} ({len(choices)} hunks)")


if __name__ == "__main__":
    if sys.argv[1] == "show":
        show(sys.argv[2])
    elif sys.argv[1] == "resolve":
        resolve(sys.argv[2], sys.argv[3:])
