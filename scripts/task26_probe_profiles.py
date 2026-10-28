#!/usr/bin/env python3
"""Task 26: replay the web port's innertube profile chain for the failing track.
Tests each PLAYBACK_PROFILES entry + WEB_REMIX client exactly like
liner-app/src/shared/youtube/innertube/{profileAudio,webRemixAudio}.ts
"""
import json, sys, urllib.request, urllib.error

VIDEO_IDS = ["VrZpGEO_o5Q", "R4EKv2uoOJc"]

PROFILES = [
    {
        "name": "TVHTML5",
        "clientVersion": "7.20260707.07.00",
        "clientIdHeader": "7",
        "ua": "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
        "extra": {},
        "requiresJsPlayer": True,
    },
    {
        "name": "VISIONOS",
        "clientVersion": "1.02",
        "clientIdHeader": "101",
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        "extra": {
            "osName": "visionOS", "osVersion": "26.5.23O471",
            "deviceMake": "Apple", "deviceModel": "RealityDevice17,1",
        },
        "requiresJsPlayer": False,
    },
    {
        "name": "ANDROID_VR",
        "clientVersion": "1.65.10",
        "clientIdHeader": "28",
        "ua": "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
        "extra": {
            "osName": "Android", "osVersion": "12L", "deviceMake": "Oculus",
            "deviceModel": "Quest 3", "androidSdkVersion": 32,
        },
        "requiresJsPlayer": False,
    },
]

def player_request(profile, video_id, visitor_data=None):
    client = {
        "clientName": profile["name"],
        "clientVersion": profile["clientVersion"],
        "hl": "en",
        "gl": "US",
        **profile["extra"],
    }
    if visitor_data:
        client["visitorData"] = visitor_data
    body = {
        "context": {"client": client},
        "videoId": video_id,
        "contentCheckOk": True,
        "racyCheckOk": True,
        "params": "8AEB",
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": profile["ua"],
        "Origin": "https://www.youtube.com",
        "X-Youtube-Client-Name": profile["clientIdHeader"],
        "X-Youtube-Client-Version": profile["clientVersion"],
    }
    req = urllib.request.Request(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        data=json.dumps(body).encode(), headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return res.status, json.load(res), dict(res.headers)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e), dict(e.headers)
        except Exception:
            return e.code, {}, dict(e.headers)

def summarize(tag, status, data):
    ps = data.get("playabilityStatus", {})
    fmts = data.get("streamingData", {}).get("adaptiveFormats", [])
    audio = [
        f for f in fmts
        if f.get("audioQuality") or (f.get("mimeType", "").startswith("audio/"))
    ]
    has_url = sum(1 for f in audio if f.get("url"))
    has_cipher = sum(1 for f in audio if f.get("signatureCipher"))
    print(f"[{tag}] http={status} playability={ps.get('status')} reason={ps.get('reason')!r}")
    print(f"    audio formats={len(audio)} with_url={has_url} with_cipher={has_cipher}")
    reasons = data.get("playerCaptionsTracklistRenderer")
    # SABR detection
    if "streamingData" in data and not fmts:
        sd = data["streamingData"]
        print(f"    streamingData keys: {list(sd.keys())}")
    for k in ("signatureTimestamp",):
        if k in data:
            print(f"    {k}={data[k]}")
    pnr = ps.get("playerDesktopUri") or ""
    if ps.get("errorScreen"):
        print(f"    errorScreen: {json.dumps(ps.get('errorScreen'))[:200]}")

for vid in VIDEO_IDS:
    print("=" * 70)
    print(f"VIDEO {vid}")
    print("=" * 70)
    for profile in PROFILES:
        status, data, headers = player_request(profile, vid)
        summarize(profile["name"], status, data)
        print()
