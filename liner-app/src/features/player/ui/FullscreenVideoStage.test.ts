import { describe, expect, it } from "vitest";
import {
  getTrackVideoId,
  syncVideoWithAudio,
  type YTPlayerLike,
} from "./FullscreenVideoStage";

/**
 * Focused tests for the YouTube-Music-style video stage:
 *  - video id extraction from the current track
 *  - the mirror loop that glues the muted frame to #liner-audio
 *    (play/pause mirroring, drift re-seek, playback-rate mirroring)
 */

type PlayerStub = {
  state: string;
  time: number;
  rate: number;
  calls: string[];
};

function makePlayer(overrides: Partial<PlayerStub> = {}) {
  const stub: PlayerStub = { state: "paused", time: 0, rate: 1, calls: [], ...overrides };
  const player = {
    getPlayerState: () => stub.state,
    getCurrentTime: () => stub.time,
    getPlaybackRate: () => stub.rate,
    mute: () => stub.calls.push("mute"),
    playVideo: () => stub.calls.push("play"),
    pauseVideo: () => stub.calls.push("pause"),
    seekTo: (s: number) => stub.calls.push(`seek:${s}`),
    setPlaybackRate: (r: number) => {
      stub.calls.push(`rate:${r}`);
      stub.rate = r;
    },
  };
  return { stub, player: player as unknown as YTPlayerLike };
}

function makeAudio(overrides: { paused?: boolean; currentTime?: number; playbackRate?: number } = {}) {
  return {
    paused: false,
    currentTime: 30,
    playbackRate: 1,
    ...overrides,
  } as unknown as HTMLAudioElement;
}

describe("getTrackVideoId", () => {
  it("extracts the video id from yt: track ids", () => {
    expect(getTrackVideoId({ id: "yt:dQw4w9WgXcQ" } as never)).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-YouTube tracks and null tracks", () => {
    expect(getTrackVideoId({ id: "sc:123456" } as never)).toBeNull();
    expect(getTrackVideoId({ id: "liner-abc" } as never)).toBeNull();
    expect(getTrackVideoId(null)).toBeNull();
  });
});

describe("syncVideoWithAudio", () => {
  it("pauses the video when the audio is paused", () => {
    const { stub, player } = makePlayer({ state: "playing" });
    syncVideoWithAudio(player, makeAudio({ paused: true }));
    expect(stub.calls).toEqual(["pause"]);
  });

  it("plays the video when the audio plays but the frame is paused", () => {
    const { stub, player } = makePlayer({ state: "paused" });
    syncVideoWithAudio(player, makeAudio({ paused: false }));
    expect(stub.calls).toEqual(["play"]);
  });

  it("does nothing while buffering near the audio position", () => {
    const { stub, player } = makePlayer({ state: "buffering", time: 30.2 });
    syncVideoWithAudio(player, makeAudio({ paused: false, currentTime: 30 }));
    expect(stub.calls).toEqual([]);
  });

  it("re-seeks when the frame drifts beyond the tolerance", () => {
    const { stub, player } = makePlayer({ state: "playing", time: 33.5 });
    syncVideoWithAudio(player, makeAudio({ paused: false, currentTime: 30 }));
    expect(stub.calls).toEqual(["seek:30"]);
  });

  it("leaves the frame alone when drift is inside the tolerance", () => {
    const { stub, player } = makePlayer({ state: "playing", time: 30.8 });
    syncVideoWithAudio(player, makeAudio({ paused: false, currentTime: 30 }));
    expect(stub.calls).toEqual([]);
  });

  it("mirrors the audio playback rate", () => {
    const { stub, player } = makePlayer({ state: "playing", time: 30, rate: 1 });
    syncVideoWithAudio(player, makeAudio({ paused: false, playbackRate: 1.5 }));
    expect(stub.calls).toEqual(["rate:1.5"]);
    expect(stub.rate).toBe(1.5);
  });
});
