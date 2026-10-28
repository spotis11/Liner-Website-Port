#!/usr/bin/env python3
"""Task 26: test WEB / YTMUSIC / MWEB clients for the blocked video."""
import json, urllib.request, urllib.error

VIDEO_IDS = ["VrZpGEO_o5Q", "R4EKv2uoOJc"]

CLIENTS = [
    {
        "name": "WEB",
        "clientVersion": "2.20251015.01.00",
        "clientIdHeader": "1",
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    {
        "name": "MWEB",
        "clientVersion": "2.20251015.01.00",
        "clientIdHeader": "2",
        "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
    {
        "name": "WEB_REMIX",  # YTMUSIC — what youtubei.js uses with PO token
        "clientVersion": "1.20251015.01.00",
        "clientIdHeader": "67",
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    {
        "name": "IOS",
        "clientVersion": "20.10.4",
        "clientIdHeader": "5",
        "ua": "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
        "extra": {"deviceMake": "Apple", "deviceModel": "iPhone16,2", "osName": "iPhone", "osVersion": "18.3.2.22D82"},
    },
]

def player_request(client, video_id):
    ctx_client = {
        "clientName": client["name"],
        "clientVersion": client["clientVersion"],
        "hl": "en",
        "gl": "US",
        **client.get("extra", {}),
    }
    body = {
        "context": {"client": ctx_client},
        "videoId": video_id,
        "contentCheckOk": True,
        "racyCheckOk": True,
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": client["ua"],
        "Origin": "https://www.youtube.com",
        "X-Youtube-Client-Name": client["clientIdHeader"],
        "X-Youtube-Client-Version": client["clientVersion"],
    }
    req = urllib.request.Request(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        data=json.dumps(body).encode(), headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}

for vid in VIDEO_IDS:
    print("=" * 66)
    print(f"VIDEO {vid}")
    for client in CLIENTS:
        status, data = player_request(client, vid)
        ps = data.get("playabilityStatus", {})
        fmts = data.get("streamingData", {}).get("adaptiveFormats", [])
        audio = [f for f in fmts if f.get("mimeType", "").startswith("audio/")]
        with_url = sum(1 for f in audio if f.get("url"))
        with_cipher = sum(1 for f in audio if f.get("signatureCipher"))
        print(f"  [{client['name']:>9}] http={status} play={ps.get('status')} reason={ps.get('reason')!r} audio={len(audio)} url={with_url} cipher={with_cipher}")
