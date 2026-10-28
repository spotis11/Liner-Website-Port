#!/usr/bin/env python3
"""Search YouTube innertube for 'JD Smith Flashback' to get the video ID (Task 26)."""
import json, urllib.request

BODY = {
    "context": {
        "client": {
            "clientName": "WEB",
            "clientVersion": "2.20251015.01.00",
            "hl": "en",
            "gl": "US",
        }
    },
    "query": "JD Smith Flashback Original Mix",
}

req = urllib.request.Request(
    "https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    data=json.dumps(BODY).encode(),
    headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Origin": "https://www.youtube.com",
    },
)

with urllib.request.urlopen(req, timeout=20) as res:
    data = json.load(res)

def walk(obj):
    if isinstance(obj, dict):
        if "videoRenderer" in obj:
            vr = obj["videoRenderer"]
            vid = vr.get("videoId")
            title = "".join(r.get("text", "") for r in vr.get("title", {}).get("runs", []))
            author = vr.get("ownerText", {}).get("runs", [{}])[0].get("text", "")
            length = vr.get("lengthText", {}).get("simpleText", "?")
            print(f"{vid}  {length:>8}  {author} - {title}")
        for v in obj.values():
            walk(v)
    elif isinstance(obj, list):
        for v in obj:
            walk(v)

walk(data)
