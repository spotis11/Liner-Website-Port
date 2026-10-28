// Curated "popular artists" options for onboarding step 2.
// Names are resolved through the live catalog search so the wizard shows real
// covers, exactly like the rest of the app. Failures degrade gracefully —
// the wizard never hard-blocks on the artist step.

import { api, type ApiArtist } from "@/shared/api";

export interface PopularArtistOption {
  id: string;
  name: string;
  coverUrl: string | null;
}

/** Household names the user asked for ("popular artist like Michael Jackson"). */
export const POPULAR_ARTIST_NAMES = [
  "Michael Jackson",
  "Drake",
  "Taylor Swift",
  "The Weeknd",
  "Adele",
  "Queen",
  "Eminem",
  "Rihanna",
  "Bruno Mars",
  "Dua Lipa",
  "Billie Eilish",
  "BTS",
] as const;

function toOption(artist: ApiArtist): PopularArtistOption | null {
  if (artist.type !== "artist") return null;
  return {
    id: artist.id,
    name: artist.name,
    coverUrl: artist.cover?.url ?? null,
  };
}

/**
 * Resolve the curated names to real catalog artists. AllSettled keeps one
 * flaky request from sinking the whole grid; duplicates are dropped.
 */
export async function fetchPopularArtistOptions(): Promise<PopularArtistOption[]> {
  const settled = await Promise.allSettled(
    POPULAR_ARTIST_NAMES.map(async (name) => {
      const res = await api.search(name, "artist");
      const first = res.items.find((item) => item.type === "artist");
      return first ? toOption(first) : null;
    }),
  );

  const seen = new Set<string>();
  const options: PopularArtistOption[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value) continue;
    if (seen.has(result.value.id)) continue;
    seen.add(result.value.id);
    options.push(result.value);
  }
  return options;
}
