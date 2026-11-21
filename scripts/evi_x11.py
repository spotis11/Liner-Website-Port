#!/usr/bin/env python3
"""X11 helpers: move/click/type on the virtual display, plus screenshot.
Usage:
  evi_x11.py click <x> <y> [double]
  evi_x11.py move <x> <y>
  evi_x11.py type <text>
  evi_x11.py key <keysym>   e.g. Return, Escape, space
  evi_x11.py shot <out.png>
"""
import sys, time

from Xlib import X, display, protocol
from Xlib.ext import xtest

d = display.Display(":99")
root = d.screen().root


def move(x, y):
    xtest.fake_input(d, X.MotionNotify, x=int(x), y=int(y))
    d.sync()


def click(x, y, double=False):
    move(x, y)
    time.sleep(0.12)
    xtest.fake_input(d, X.ButtonPress, 1)
    xtest.fake_input(d, X.ButtonRelease, 1)
    d.sync()
    if double:
        time.sleep(0.08)
        xtest.fake_input(d, X.ButtonPress, 1)
        xtest.fake_input(d, X.ButtonRelease, 1)
        d.sync()


def key(k, mods=None):
    ks = d.keysym_to_keycode(ord(k) if len(k) == 1 else _special(k))
    for m in mods or []:
        xtest.fake_input(d, X.KeyPress, m)
    xtest.fake_input(d, X.KeyPress, ks)
    xtest.fake_input(d, X.KeyRelease, ks)
    for m in reversed(mods or []):
        xtest.fake_input(d, X.KeyRelease, m)
    d.sync()


def _special(name):
    # minimal keysym table
    table = {
        "Return": 0xFF0D, "Escape": 0xFF1B, "BackSpace": 0xFF08,
        "Tab": 0xFF09, "space": 0x20, "Down": 0xFF54, "Up": 0xFF53,
        "Left": 0xFF51, "Right": 0xFF53, "Home": 0xFF50, "End": 0xFF57,
        "ctrl+a": 0x61, "Delete": 0xFFFF,
    }
    return table[name]


def type_text(t):
    for ch in t:
        k = d.keysym_to_keycode(ord(ch))
        xtest.fake_input(d, X.KeyPress, k)
        xtest.fake_input(d, X.KeyRelease, k)
    d.sync()


def shot(path):
    import mss
    with mss.mss() as sct:
        sct.shot(mon=1, output=path)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "click":
        click(sys.argv[2], sys.argv[3], len(sys.argv) > 4 and sys.argv[4] == "double")
    elif cmd == "move":
        move(sys.argv[2], sys.argv[3])
    elif cmd == "type":
        type_text(sys.argv[2])
    elif cmd == "key":
        key(sys.argv[2])
    elif cmd == "shot":
        shot(sys.argv[2])
    print("ok:", cmd)
