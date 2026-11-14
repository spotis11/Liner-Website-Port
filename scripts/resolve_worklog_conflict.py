#!/usr/bin/env python3
"""Resolve worklog.md rebase conflict: insert the v1.23.1 chapter (ours=theirs
side, chronologically ~08:xxZ) before the 09:1xZ chapter (HEAD side)."""
import re

p = "/home/z/my-project/worklog.md"
s = open(p, encoding="utf-8").read()

m = re.search(
    r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n",
    s,
    re.S,
)
assert m, "conflict markers not found"
head_side, my_side = m.group(1), m.group(2)

# my_side = the v1.23.1 chapter (ends with the ops NOTE line)
# head_side begins with "## 2026-11-13 (09:1xZ)" — insert my chapter before it
anchor = "## 2026-11-13 (09:1xZ)"
assert anchor in head_side, "anchor chapter not found"
head_side = head_side.replace(anchor, my_side.rstrip() + "\n\n" + anchor, 1)

open(p, "w", encoding="utf-8").write(s[: m.start()] + head_side + s[m.end():])
print("resolved — markers left:", s[: m.start()].count("<<<<<<<") + open(p).count("<<<<<<<"))
