import { describe, it, expect } from "vitest";
import {
  buildPresenceActivity,
  toDiscordImageUrl,
  toDirectAssetKey,
  absolutizeHttpUrl,
  activityFingerprint,
} from "./discordGateway";
import { DEFAULT_DISCORD_SETTINGS } from "../contracts";
import type { DiscordRpcStatePayload } from "../contracts";

const NOW = 1_700_000_000_000;

const playingPayload: DiscordRpcStatePayload = {
  status: "playing",
  track: {
    id: "t1",
    title: "Song title",
    artist: "Artist name",
    album: "Album name",
    coverUrl: "https://cdn.example.com/cover.jpg",
    durationMs: 200_000,
  },
  positionMs: 30_000,
  durationMs: 200_000,
  artistImageUrl: "https://cdn.example.com/artist.jpg",
};

const settings = { ...DEFAULT_DISCORD_SETTINGS };

describe("buildPresenceActivity", () => {
  it("returns null when idle or errored", () => {
    expect(
      buildPresenceActivity(
        { ...playingPayload, status: "idle", track: null },
        settings,
        NOW,
      ),
    ).toBeNull();
    expect(buildPresenceActivity({ ...playingPayload, status: "error" }, settings, NOW)).toBeNull();
  });

  it("returns null when disabled", () => {
    expect(
      buildPresenceActivity(playingPayload, { ...settings, enabled: false }, NOW),
    ).toBeNull();
  });

  it("returns null when paused and showPaused is off", () => {
    expect(
      buildPresenceActivity(
        { ...playingPayload, status: "paused" },
        { ...settings, showPaused: false },
        NOW,
      ),
    ).toBeNull();
  });

  it("builds a LISTENING activity with artist in the header by default", () => {
    const activity = buildPresenceActivity(playingPayload, settings, NOW)!;
    expect(activity.type).toBe(2);
    expect(activity.name).toBe("Artist name");
    expect(activity.details).toBe("Song title");
    expect(activity.state).toBe("Artist name");
    expect(activity.status_display_type).toBe(1); // "Listening to [state]"
  });

  it("supports the app display format", () => {
    const activity = buildPresenceActivity(
      playingPayload,
      { ...settings, statusDisplayType: "app" },
      NOW,
    )!;
    expect(activity.name).toBe("Liner");
    expect(activity.details).toBe("Song title");
    expect(activity.state).toBe("Artist name");
    expect(activity.status_display_type).toBe(0);
  });

  it("supports artist_title and title_artist formats", () => {
    const artistTitle = buildPresenceActivity(
      playingPayload,
      { ...settings, statusDisplayType: "artist_title" },
      NOW,
    )!;
    expect(artistTitle.name).toBe("Artist name - Song title");
    expect(artistTitle.status_display_type).toBe(1);

    const titleArtist = buildPresenceActivity(
      playingPayload,
      { ...settings, statusDisplayType: "title_artist" },
      NOW,
    )!;
    expect(titleArtist.name).toBe("Song title - Artist name");
    expect(titleArtist.status_display_type).toBe(2);
  });

  it("computes timestamps from position with payload-time compensation", () => {
    const activity = buildPresenceActivity(playingPayload, settings, NOW, NOW - 5_000)!;
    // 30s into the track, payload is 5s old -> expect start = now - 35s
    expect(activity.timestamps?.start).toBe(NOW - 35_000);
    expect(activity.timestamps?.end).toBe(NOW - 35_000 + 200_000);
  });

  it("omits timestamps when paused", () => {
    const activity = buildPresenceActivity(
      { ...playingPayload, status: "paused" },
      settings,
      NOW,
    )!;
    expect(activity.timestamps).toBeUndefined();
    expect(activity.state).toBe("Artist name (Paused)");
  });

  it("omits timestamps when showTime is off", () => {
    const activity = buildPresenceActivity(
      playingPayload,
      { ...settings, showTime: false },
      NOW,
    )!;
    expect(activity.timestamps).toBeUndefined();
  });

  it("includes cover + artist artwork with mp: prefix", () => {
    const activity = buildPresenceActivity(playingPayload, settings, NOW)!;
    expect(activity.assets?.large_image).toBe("mp:https://cdn.example.com/cover.jpg");
    expect(activity.assets?.large_text).toBe("Album name");
    expect(activity.assets?.small_image).toBe("mp:https://cdn.example.com/artist.jpg");
    expect(activity.assets?.small_text).toBe("Artist name");
  });

  it("respects showArtwork / showArtistSmallImage toggles", () => {
    const noArt = buildPresenceActivity(
      playingPayload,
      { ...settings, showArtwork: false, showArtistSmallImage: false },
      NOW,
    )!;
    expect(noArt.assets).toBeUndefined();
  });

  it("drops non-https and oversized image urls", () => {
    const activity = buildPresenceActivity(
      {
        ...playingPayload,
        track: {
          id: "t1",
          title: "Song title",
          artist: "Artist name",
          album: "Album name",
          coverUrl: "http://insecure.example.com/x.jpg",
          durationMs: 200_000,
        },
        artistImageUrl: `https://cdn.example.com/${"a".repeat(300)}.jpg`,
      },
      settings,
      NOW,
    )!;
    expect(activity.assets).toBeUndefined();
  });

  it("sanitizes over-long text to 128 chars", () => {
    const activity = buildPresenceActivity(
      {
        ...playingPayload,
        track: {
          id: "t1",
          title: "x".repeat(500),
          artist: "Artist name",
          coverUrl: "https://cdn.example.com/cover.jpg",
          durationMs: 200_000,
        },
      },
      settings,
      NOW,
    )!;
    expect(activity.details?.length).toBe(128);
  });
});

describe("activityFingerprint", () => {
  it("is stable for identical content and ignores position changes", () => {
    expect(activityFingerprint(playingPayload)).toBe(activityFingerprint(playingPayload));
    expect(activityFingerprint({ ...playingPayload, positionMs: 99_000 })).toBe(
      activityFingerprint(playingPayload),
    );
  });

  it("changes when the track, status or artwork changes", () => {
    const base = activityFingerprint(playingPayload);
    expect(activityFingerprint({ ...playingPayload, status: "paused" })).not.toBe(base);
    expect(
      activityFingerprint({ ...playingPayload, track: { ...playingPayload.track!, title: "Other" } }),
    ).not.toBe(base);
    expect(
      activityFingerprint({
        ...playingPayload,
        track: { ...playingPayload.track!, coverUrl: "https://cdn.example.com/other.jpg" },
      }),
    ).not.toBe(base);
    expect(activityFingerprint({ ...playingPayload, artistImageUrl: undefined })).not.toBe(base);
  });

  it("collapses idle payloads to a single key", () => {
    expect(activityFingerprint(null)).toBe("idle");
    expect(activityFingerprint({ ...playingPayload, track: null })).toBe("idle");
  });
});

describe("url helpers", () => {
  it("toDiscordImageUrl only accepts absolute https up to 256 chars", () => {
    expect(toDiscordImageUrl("https://ok.example.com/a.png")).toBe("https://ok.example.com/a.png");
    expect(toDiscordImageUrl("http://no.example.com/a.png")).toBeUndefined();
    expect(toDiscordImageUrl("/relative/path.png")).toBeUndefined();
    expect(toDiscordImageUrl("not a url")).toBeUndefined();
    expect(toDiscordImageUrl(`https://ok.example.com/${"a".repeat(300)}`)).toBeUndefined();
  });

  it("absolutizeHttpUrl resolves relative urls against the origin", () => {
    expect(absolutizeHttpUrl("/covers/1.jpg", "https://app.example.com")).toBe(
      "https://app.example.com/covers/1.jpg",
    );
    expect(absolutizeHttpUrl("https://cdn.example.com/a.jpg", "https://app.example.com")).toBe(
      "https://cdn.example.com/a.jpg",
    );
    expect(absolutizeHttpUrl(undefined, "https://app.example.com")).toBeUndefined();
  });
});

describe("toDirectAssetKey", () => {
  it("maps discord CDN urls to direct mp: keys", () => {
    expect(toDirectAssetKey("https://cdn.discordapp.com/attachments/1/2/cover.png")).toBe(
      "mp:attachments/1/2/cover.png",
    );
    expect(toDirectAssetKey("https://media.discordapp.net/attachments/1/2/art.png?ex=1&is=2")).toBe(
      "mp:attachments/1/2/art.png?ex=1&is=2",
    );
  });

  it("returns undefined for external hosts (they need external-assets registration)", () => {
    expect(toDirectAssetKey("https://yt3.googleusercontent.com/abc=w512-h512-l90-rj")).toBeUndefined();
    expect(toDirectAssetKey("https://i.ytimg.com/vi/x/hqdefault.jpg")).toBeUndefined();
    expect(toDirectAssetKey("blob:https://app/x")).toBeUndefined();
    expect(toDirectAssetKey("not a url")).toBeUndefined();
  });
});
