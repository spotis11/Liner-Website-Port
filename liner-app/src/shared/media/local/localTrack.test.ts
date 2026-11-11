import { describe, expect, it } from "vitest";
import { toVideoId } from "@/shared/youtube";
import { toSoundCloudTrackId } from "@/shared/media/soundcloud";
import {
  isLocalTrackId,
  localFileId,
  localRecordToTrack,
  toLocalTrackId,
} from "./index";

const record = {
  id: "0123456789abcdef0123",
  title: "Roygbiv",
  artist: "Boards of Canada",
  durationMs: 151000,
  fileName: "roygbiv.mp3",
  mimeType: "audio/mpeg",
  byteSize: 10,
  addedAt: 1,
};

describe("local tracks", () => {
  it("map to tracks with the local: id prefix", () => {
    const track = localRecordToTrack(record);
    expect(track).toMatchObject({
      id: "local:0123456789abcdef0123",
      artists: "Boards of Canada",
      coverUrl: "",
    });
    expect(track.album).toBeUndefined();
  });

  it("keep the album title when the file carries one", () => {
    const track = localRecordToTrack({
      ...record,
      album: "Music Has the Right to Children",
    });
    expect(track.album).toEqual({
      id: "0123456789abcdef0123",
      title: "Music Has the Right to Children",
    });
  });

  it("are never mistaken for youtube or soundcloud ids", () => {
    const { id } = localRecordToTrack(record);
    expect(isLocalTrackId(id)).toBe(true);
    expect(toVideoId(id)).toBeNull();
    expect(toSoundCloudTrackId(id)).toBeNull();
    expect(isLocalTrackId("dQw4w9WgXcQ")).toBe(false);
  });

  it("round-trip the file id out of the track id", () => {
    const trackId = toLocalTrackId(record.id);
    expect(localFileId(trackId)).toBe(record.id);
  });
});
