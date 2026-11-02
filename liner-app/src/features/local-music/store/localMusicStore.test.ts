// Task 36: local music store — audio filtering for directory-picked files
// (webkitdirectory lists every file in the folder, not just audio).

import { describe, expect, it } from "vitest";
import { filterAudioFiles } from "./localMusicStore";

function file(name: string, type = "application/octet-stream"): File {
  return new File(["x"], name, { type });
}

describe("filterAudioFiles", () => {
  it("keeps audio extensions even with a generic mime type", () => {
    const files = [
      file("song.mp3"),
      file("album.flac"),
      file("track 01.m4a"),
      file("audio.ogg"),
    ];
    expect(filterAudioFiles(files).map((f) => f.name)).toEqual([
      "song.mp3",
      "album.flac",
      "track 01.m4a",
      "audio.ogg",
    ]);
  });

  it("keeps audio/* mime types without a known extension", () => {
    const files = [file("weird", "audio/mpeg")];
    expect(filterAudioFiles(files)).toHaveLength(1);
  });

  it("drops non-audio files a directory picker returns", () => {
    const files = [
      file("cover.jpg", "image/jpeg"),
      file("notes.txt", "text/plain"),
      file("playlist.m3u"),
      file(".DS_Store"),
      file("song.mp3"),
    ];
    expect(filterAudioFiles(files).map((f) => f.name)).toEqual(["song.mp3"]);
  });
});
