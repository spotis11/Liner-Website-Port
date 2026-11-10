import type { InnertubeProfile } from "./innertubeClient";

export const TV_PROFILE: InnertubeProfile = {
  clientName: "TVHTML5",
  clientVersion: "7.20260707.07.00",
  clientIdHeader: "7",
  origin: "https://www.youtube.com",
  userAgent:
    "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
  includeUserAgentInContext: true,
  requiresJsPlayer: true,
};

export const TV_ACCOUNT_PROFILE: InnertubeProfile = {
  ...TV_PROFILE,
  acceptsOAuth: true,
};

export const VISIONOS_PROFILE: InnertubeProfile = {
  clientName: "VISIONOS",
  clientVersion: "1.02",
  clientIdHeader: "101",
  origin: "https://www.youtube.com",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  includeUserAgentInContext: true,
  extraContext: {
    osName: "visionOS",
    osVersion: "26.5.23O471",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
  },
};

export const ANDROID_VR_PROFILE: InnertubeProfile = {
  clientName: "ANDROID_VR",
  clientVersion: "1.65.10",
  clientIdHeader: "28",
  origin: "https://www.youtube.com",
  userAgent:
    "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  includeUserAgentInContext: true,
  extraContext: {
    osName: "Android",
    osVersion: "12L",
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    androidSdkVersion: 32,
  },
};

export const IOS_PROFILE: InnertubeProfile = {
  clientName: "IOS",
  clientVersion: "20.10.4",
  clientIdHeader: "5",
  origin: "https://www.youtube.com",
  userAgent:
    "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  includeUserAgentInContext: true,
  extraContext: {
    osName: "iOS",
    osVersion: "18.3.2.22D60",
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
  },
};

// Android YouTube Music app client. Needs a signed-in context on datacenter
// networks (LOGIN_REQUIRED), but on residential egress it hands out clean
// streams — kept in the chain behind IOS like Riff does with its client race.
export const ANDROID_MUSIC_PROFILE: InnertubeProfile = {
  clientName: "ANDROID_MUSIC",
  clientVersion: "7.27.52",
  clientIdHeader: "21",
  origin: "https://music.youtube.com",
  userAgent:
    "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14; en_US; Quest 3) gzip",
  includeUserAgentInContext: true,
  extraContext: {
    androidSdkVersion: 34,
  },
};

// The two Riff clients close the chain: they need no JS player, no SABR
// handshake and no po token — their player responses carry plain `url` audio
// formats that googlevideo serves to datacenter egress where the device-style
// profiles above get refused. Profile order below is load-bearing for tests
// and for the lastWorkingProfile preference: the Riff clients stay LAST so
// every existing resolution path is untouched and they only rescue the
// "YouTube refused every audio stream from this network" case.
// Client definitions adapted from Riff (MIT) — https://github.com/rootscripts/riff
export const PLAYBACK_PROFILES: readonly InnertubeProfile[] = [
  TV_PROFILE,
  VISIONOS_PROFILE,
  ANDROID_VR_PROFILE,
  IOS_PROFILE,
  ANDROID_MUSIC_PROFILE,
];
