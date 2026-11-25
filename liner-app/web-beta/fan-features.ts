/*
 * Liner 0.2.20 beta web shell — fan feature layer (DOM side).
 *
 * Runs AFTER the beta app module. The four fan features live INSIDE the
 * app's own surfaces — no floating buttons (the owner explicitly rejected a
 * dock):
 *
 *   1. Changelog    → a native nav-rail item in the left sidebar (same
 *                     44×36 icon-button recipe as Home/Search/Library),
 *                     opening the release-notes modal.
 *   2. AI Translate → a pill in the fullscreen player's top-center controls,
 *                     next to the lyrics-offset pill; synced translated
 *                     lyrics under the original lines (Liner AI + Google).
 *   3. Lyric styles → the same tools pill; 12 themes drawn over the beta's
 *                     canvas lyrics, synced to the song.
 *   4. Discord RPC  → fully silent, handled in the shim (arRPC primary,
 *                     gateway fallback) — the app's own Settings → Discord
 *                     section reports "Connected via arRPC".
 *
 * Data comes from the shim (loaded before the app):
 *   window.__linerFanState  — { status, track, positionMs, durationMs }
 *   window.__linerFanLyricsRaw — Map<trackId, {trackId, body}> (sniffed SSE)
 *   events "liner-web-state" / "liner-web-lyrics"
 */

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

type FanLine = { t: number | null; text: string };
type FanLyrics = {
  trackId: string;
  lines: FanLine[];
  plain: string;
  format: string;
  provider: string;
  synced: boolean;
  fetchedAt: number;
};

interface FanWin extends Window {
  __linerFanState?: {
    status: string;
    track: { id: string; title: string; artist: string; album?: string; coverUrl?: string; durationMs: number } | null;
    positionMs: number;
    durationMs: number;
    updatedAt: number;
  };
  __linerFanLyrics?: Map<string, FanLyrics>;
  /** raw SSE bodies sniffed by the shim — converted into FanLyrics here */
  __linerFanLyricsRaw?: Map<string, { trackId: string; body: string }>;
  __linerFanDiscord?: {
    connect: (token: string) => void;
    disconnect: () => void;
    status: () => { connected: boolean; username?: string; connecting?: boolean; error?: string | null };
  };
}

const w = window as unknown as FanWin;
const doc = document;

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* full/private mode — features just don't persist */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "text") node.textContent = String(value);
    else if (key === "style") (node as HTMLElement).style.cssText = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? doc.createTextNode(child) : child);
  }
  return node;
}

function svgIcon(paths: string, extra = ""): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  if (extra) svg.setAttribute("class", extra);
  svg.style.width = "20px";
  svg.style.height = "20px";
  for (const p of paths.split("|")) {
    const path = doc.createElementNS(ns, "path");
    path.setAttribute("d", p);
    svg.appendChild(path);
  }
  return svg;
}

const ICON_HISTORY =
  "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8|M3 3v5h5|M12 7v5l4 2";
const ICON_TRANSLATE =
  "M4 5h7|M9 3v2c0 4.4-2.7 7.5-6 8.5|M6 5c0 4 2.5 7 7 8.5|M13 21l4.5-11L22 21|M14.8 17h5.4";
const ICON_STYLES =
  "M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H13a1.5 1.5 0 0 1 0-3h4a4 4 0 0 0 4-4c0-4-4-7-9-7z|M7.5 10.5h.01|M10 7h.01|M14.5 7.5h.01";

const FAN_CSS = `
.lf-tooltip{position:fixed;z-index:2147483400;background:#1c1c22;color:#e8e8ea;font-size:11.5px;font-weight:600;padding:5px 9px;border-radius:8px;pointer-events:none;font-family:Montserrat,Inter,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);white-space:nowrap}
.lf-backdrop{position:fixed;inset:0;z-index:2147483100;background:rgba(4,4,6,.6);backdrop-filter:blur(6px);font-family:Montserrat,Inter,system-ui,sans-serif}
.lf-panel{position:fixed;z-index:2147483200;background:#121216;color:#e8e8ea;border:1px solid rgba(255,255,255,.1);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.6);font-family:Montserrat,Inter,system-ui,sans-serif;overflow:hidden;display:flex;flex-direction:column}
.lf-panel h2{margin:0;font-size:15.5px;font-weight:700}
.lf-panel .lf-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
.lf-panel .lf-close{all:unset;cursor:pointer;color:#8a8a92;font-size:18px;line-height:1;padding:2px 6px;border-radius:8px}
.lf-panel .lf-close:hover{color:#fff;background:rgba(255,255,255,.08)}
.lf-panel .lf-body{overflow:auto;padding:12px 16px 16px;font-size:13px;line-height:1.55}
.lf-badge{display:inline-flex;align-items:center;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:6px;padding:2px 7px;margin-right:8px}
.lf-badge.added{background:rgba(63,174,90,.16);color:#6fd88a}
.lf-badge.fixed{background:rgba(74,144,226,.16);color:#7db4ee}
.lf-badge.changed{background:rgba(224,140,63,.16);color:#e8a968}
.lf-release{margin:0 0 14px}
.lf-release .lf-ver{font-size:14.5px;font-weight:700;color:#fff}
.lf-release .lf-date{font-size:11px;color:#8a8a92;margin-left:8px}
.lf-release .lf-title{font-size:12.5px;color:#cfcfd4;margin:2px 0 8px}
.lf-entry{display:flex;align-items:baseline;margin:0 0 7px;color:#c4c4ca}
select.lf-input,input.lf-input{background:#1b1b21;color:#e8e8ea;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:7px 9px;font-size:12.5px;font-family:inherit;outline:none}
select.lf-input:focus,input.lf-input:focus{border-color:rgba(190,255,170,.5)}
.lf-btn{all:unset;cursor:pointer;background:rgba(190,255,170,.16);border:1px solid rgba(190,255,170,.45);color:#d6ffbc;font-size:12.5px;font-weight:700;border-radius:9px;padding:7px 14px;text-align:center}
.lf-btn:hover{background:rgba(190,255,170,.26)}
.lf-btn.ghost{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.16);color:#e8e8ea;font-weight:600}
.lf-status{font-size:11.5px;color:#8a8a92}
.lf-status.ok{color:#8fe36b}.lf-status.err{color:#ff8080}
/* lyric themes overlay */
.lf-overlay{position:fixed;inset:0;z-index:2147482900;display:flex;flex-direction:column;justify-content:center;align-items:center;overflow:hidden;padding:0 6vw;text-align:center;background:radial-gradient(120% 90% at 50% 10%, rgba(0,0,0,.14), rgba(0,0,0,.5))}
.lf-lyrics{max-height:72vh;overflow:hidden;position:relative;width:100%}
.lf-line{transition:opacity .28s,filter .28s,transform .28s;color:#fff;cursor:pointer;padding:.18em 0}
.lf-theme-card{cursor:pointer;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px;text-align:left;background:rgba(255,255,255,.03)}
.lf-theme-card:hover{border-color:rgba(190,255,170,.5)}
.lf-theme-card.on{border-color:#8fe36b;background:rgba(143,227,107,.08)}
.lf-theme-name{font-size:12.5px;font-weight:700;color:#fff}
.lf-theme-cat{font-size:10px;color:#8a8a92;letter-spacing:.06em;text-transform:uppercase}
.lf-theme-preview{font-size:15px;color:#fff;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:640px){.lf-overlay{padding:0 5vw}}
`;

// ---------------------------------------------------------------------------
// playback position — capture-phase media listeners (any <audio> element)
// ---------------------------------------------------------------------------

const pos = { t: 0, dur: 0, playing: false };

function mediaOf(e: Event): HTMLMediaElement | null {
  const target = e.target as HTMLMediaElement | null;
  return target && typeof (target as HTMLMediaElement).currentTime === "number"
    ? (target as HTMLMediaElement)
    : null;
}
doc.addEventListener("timeupdate", (e) => {
  const m = mediaOf(e);
  if (m) {
    pos.t = m.currentTime;
    pos.dur = m.duration || 0;
  }
}, true);
doc.addEventListener("play", () => { pos.playing = true; }, true);
doc.addEventListener("pause", () => { pos.playing = false; }, true);
doc.addEventListener("seeked", (e) => {
  const m = mediaOf(e);
  if (m) pos.t = m.currentTime;
}, true);

function currentPositionSec(): number {
  if (pos.dur > 0 || pos.t > 0) return pos.t;
  return w.__linerFanState ? w.__linerFanState.positionMs / 1000 : 0;
}

// ---------------------------------------------------------------------------
// lyrics parsing (LRC + TTML + plain)
// ---------------------------------------------------------------------------

const LRC_TS = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[[a-z#]+:[^\]]*\]$/i;

function parseLrc(content: string): FanLine[] {
  const out: FanLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || META_TAG.test(line)) continue;
    LRC_TS.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let rest = line;
    while ((m = LRC_TS.exec(line))) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0;
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac);
      rest = line.slice(LRC_TS.lastIndex);
    }
    const text = rest.trim();
    if (!stamps.length) continue;
    if (!text || /^♪+$/.test(text)) continue;
    for (const t of stamps) out.push({ t, text });
  }
  out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return out;
}

function parseTtml(content: string): FanLine[] {
  const out: FanLine[] = [];
  const pRe = /<p\b[^>]*?begin="([^"]+)"[^>]*?>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(content))) {
    const begin = m[1];
    const text = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/\s+/g, " ")
      .trim();
    const parts = begin.split(":");
    let t: number;
    if (parts.length === 3) t = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2]);
    else if (parts.length === 2) t = Number(parts[0]) * 60 + parseFloat(parts[1]);
    else t = parseFloat(begin);
    if (!text || Number.isNaN(t)) continue;
    out.push({ t, text });
  }
  out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return out;
}

function parseLyrics(format: string, content: string): FanLine[] {
  const fmt = (format || "").toLowerCase();
  if (fmt.includes("ttml") || /<p\b[^>]*begin=/i.test(content)) return parseTtml(content);
  const lrc = parseLrc(content);
  if (lrc.length >= 2) return lrc;
  return content
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !META_TAG.test(s) && !/^♪+$/.test(s))
    .map((s) => ({ t: null as number | null, text: s }));
}

/** Fetch + register lyrics for a track via the relay's own provider pool. */
async function fetchLyrics(trackId: string, hint?: { title?: string; artist?: string; durationMs?: number }): Promise<FanLyrics | null> {
  const params = new URLSearchParams();
  if (hint?.title) params.set("title", hint.title);
  if (hint?.artist) params.set("artist", hint.artist);
  if (hint?.durationMs) params.set("durationMs", String(hint.durationMs));
  try {
    const res = await fetch(`/v1/tracks/${encodeURIComponent(trackId)}/lyrics?${params.toString()}`);
    if (!res.ok) return null;
    const text = await res.text();
    return ingestLyricsSse(trackId, text);
  } catch {
    return null;
  }
}

/** Parse the relay's SSE body (also used by the shim's network sniffer). */
function ingestLyricsSse(trackId: string, body: string): FanLyrics | null {
  let best: FanLyrics | null = null;
  for (const chunk of body.split(/\n\n/)) {
    const line = chunk.split(/\n/).find((l) => l.startsWith("data: "));
    if (!line) continue;
    try {
      const payload = JSON.parse(line.slice(6)) as {
        type?: string; status?: string;
        candidate?: { lyrics?: { format?: string; content?: string }; provider?: string };
      };
      const c = payload.candidate;
      if (payload.type === "provider" && payload.status === "found" && c?.lyrics?.content) {
        const lines = parseLyrics(c.lyrics.format ?? "", c.lyrics.content);
        if (lines.length && !best) {
          best = {
            trackId,
            lines,
            plain: c.lyrics.content,
            format: c.lyrics.format ?? "plain",
            provider: c.provider ?? "unknown",
            synced: lines.some((l) => l.t != null),
            fetchedAt: Date.now(),
          };
        }
      }
    } catch {
      /* malformed event — skip */
    }
  }
  if (best) registerLyrics(best);
  return best;
}

function registerLyrics(fan: FanLyrics): void {
  if (!w.__linerFanLyrics) w.__linerFanLyrics = new Map();
  w.__linerFanLyrics.set(fan.trackId, fan);
  doc.dispatchEvent(new CustomEvent("liner-web-lyrics", { detail: fan.trackId }));
}

// ---------------------------------------------------------------------------
// 1) changelog — native sidebar item + modal
// ---------------------------------------------------------------------------

type Release = { version: string; date: string; title: string; entries: { type: string; text: string }[] };
const SEEN_KEY = "liner_web_seen_changelog";
let newestVersion = "";
let releases: Release[] = [];

async function loadChangelog(): Promise<void> {
  if (releases.length) return;
  try {
    const res = await fetch("/liner/fan/changelog.json");
    if (!res.ok) return;
    releases = (await res.json()) as Release[];
    newestVersion = releases[0]?.version ?? "";
  } catch {
    /* changelog stays empty on failure */
  }
}

function changelogUnseen(): boolean {
  return Boolean(newestVersion) && lsGet(SEEN_KEY) !== newestVersion;
}

function openChangelog(): void {
  loadChangelog().then(() => {
    if (newestVersion) lsSet(SEEN_KEY, newestVersion);
    refreshSidebarDot();
    const panel = el("div", {
      class: "lf-panel",
      style: "width:min(480px,92vw);max-height:min(78vh,720px);left:50%;top:50%;transform:translate(-50%,-50%)",
    },
      el("div", { class: "lf-head" },
        el("div", {},
          el("h2", { text: "Changelog" }),
          el("div", { class: "lf-status", text: `${releases.length} releases` })),
        el("button", { class: "lf-close", text: "✕" })),
      el("div", { class: "lf-body" },
        releases.map((r) =>
          el("div", { class: "lf-release" },
            el("div", {},
              el("span", { class: "lf-ver", text: `v${r.version}` }),
              el("span", { class: "lf-date", text: r.date })),
            el("div", { class: "lf-title", text: r.title }),
            r.entries.map((e) =>
              el("div", { class: "lf-entry" },
                el("span", { class: `lf-badge ${e.type}`, text: e.type }),
                el("span", { text: e.text })))))));
    openLayer(panel);
  });
}

// ---------------------------------------------------------------------------
// shared modal layer
// ---------------------------------------------------------------------------

let backdrop: HTMLDivElement | null = null;
let activePanel: HTMLElement | null = null;

function openLayer(panel: HTMLElement): void {
  closeLayer();
  backdrop = el("div", { class: "lf-backdrop" });
  backdrop.addEventListener("click", closeLayer);
  doc.body.appendChild(backdrop);
  activePanel = panel;
  (panel.querySelector(".lf-close") as HTMLElement | null)?.addEventListener("click", closeLayer);
  doc.body.appendChild(panel);
}

function closeLayer(): void {
  backdrop?.remove();
  activePanel?.remove();
  backdrop = null;
  activePanel = null;
}

// ---------------------------------------------------------------------------
// 2) AI translate
// ---------------------------------------------------------------------------

const LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ru", label: "Russian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "vi", label: "Vietnamese" },
  { code: "pl", label: "Polish" },
];
const TR_LANG_KEY = "liner_web_translate_lang";
const TR_PROVIDER_KEY = "liner_web_translate_provider";
const trCacheKey = (trackId: string, lang: string, provider: string) =>
  `liner_web_tr_${provider}_${lang}_${trackId}`;

async function translateWithLiner(lines: string[], targetLang: string): Promise<string[]> {
  const res = await fetch("/api/ai-translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lines, targetLang }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = String(((await res.json()) as { error?: string }).error ?? "");
    } catch { /* keep empty */ }
    throw new Error(`Liner AI HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const data = (await res.json()) as { lines?: unknown };
  if (!Array.isArray(data.lines) || !data.lines.every((l) => typeof l === "string") || data.lines.length !== lines.length) {
    throw new Error("Unexpected Liner AI response");
  }
  return data.lines as string[];
}

async function translateWithGoogle(lines: string[], targetLang: string): Promise<string[]> {
  const out: string[] = new Array(lines.length).fill("");
  let index = 0;
  const workers = Array.from({ length: Math.min(4, lines.length) }, async () => {
    while (index < lines.length) {
      const i = index++;
      try {
        const url =
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(lines[i])}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        const data = (await res.json()) as unknown;
        if (Array.isArray(data) && Array.isArray(data[0])) {
          out[i] = (data[0] as unknown[])
            .map((part) => (Array.isArray(part) ? String(part[0] ?? "") : ""))
            .join("")
            .trim();
        }
      } catch {
        /* leave empty — the UI keeps the original line */
      }
    }
  });
  await Promise.all(workers);
  if (out.every((l) => !l)) throw new Error("Google Translate is unreachable");
  return out;
}

function currentTrackId(): string | null {
  return w.__linerFanState?.track?.id ?? null;
}

function currentLyrics(): FanLyrics | null {
  const id = currentTrackId();
  if (!id) return null;
  return w.__linerFanLyrics?.get(id) ?? null;
}

// keep the lyrics registry warm: pull from the shim sniffer, else the relay
doc.addEventListener("liner-web-state", () => {
  const id = currentTrackId();
  if (!id || w.__linerFanLyrics?.has(id)) return;
  const st = w.__linerFanState!;
  void fetchLyrics(id, {
    title: st.track?.title,
    artist: st.track?.artist,
    durationMs: st.track?.durationMs || st.durationMs || undefined,
  });
});

let translatePanel: HTMLElement | null = null;
let translateState: { fan: FanLyrics; lang: string; provider: string; lines: string[] } | null = null;
let translateBusy = false;
let translateError: string | null = null;
let userScrolledAt = 0;

function renderTranslatePanel(): void {
  if (!translatePanel) return;
  const body = translatePanel.querySelector(".lf-tr-body") as HTMLElement | null;
  if (!body) return;
  const st = w.__linerFanState;
  body.textContent = "";
  body.appendChild(el("div", { class: "lf-status", style: "margin-bottom:10px" },
    st?.track ? `${st.track.title} — ${st.track.artist}` : "Play a track to translate its lyrics"));
  if (!currentLyrics()) {
    body.appendChild(el("div", { class: "lf-status", text: "Waiting for lyrics…" }));
    return;
  }
  if (translateError) {
    body.appendChild(el("div", { class: "lf-status err", text: translateError }));
  }
  if (translateBusy) {
    body.appendChild(el("div", { class: "lf-status", text: "Translating…" }));
    return;
  }
  if (!translateState) {
    body.appendChild(el("div", { class: "lf-status", text: "Pick a language and press Translate." }));
    return;
  }
  const fan = translateState.fan;
  fan.lines.forEach((line, i) => {
    const translated = translateState!.lines[i] ?? "";
    body.appendChild(el("div", { class: "lf-tr-line", "data-i": String(i),
      style: "margin:0 0 10px" },
      el("div", { style: "font-size:11px;color:#8a8a92", text: line.text }),
      el("div", { style: "font-size:13.5px;color:#e8e8ea", text: translated || "…" })));
  });
  syncTranslateScroll(true);
}

function syncTranslateScroll(force: boolean): void {
  if (!translatePanel || !translateState || translateBusy) return;
  if (!force && Date.now() - userScrolledAt < 4000) return;
  const now = currentPositionSec();
  const lines = translateState.fan.lines;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t != null && (lines[i].t as number) <= now + 0.35) active = i;
  }
  const body = translatePanel.querySelector(".lf-tr-body") as HTMLElement | null;
  if (!body) return;
  const items = body.querySelectorAll(".lf-tr-line");
  items.forEach((node, i) => {
    (node as HTMLElement).style.color = i === active ? "#d6ffbc" : "";
  });
  if (active >= 0 && items[active]) {
    const target = items[active] as HTMLElement;
    const view = body.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (rect.top < view.top + 24 || rect.bottom > view.bottom - 24) {
      body.scrollTop += rect.top - view.top - view.height / 2 + rect.height;
    }
  }
}

function openTranslate(): void {
  const panel = el("div", {
    class: "lf-panel",
    style: "width:min(430px,92vw);max-height:min(70vh,620px);left:50%;top:50%;transform:translate(-50%,-50%)",
  },
    el("div", { class: "lf-head" },
      el("div", {},
        el("h2", { text: "AI Translate" }),
        el("div", { class: "lf-status", text: "Translated lyrics, synced to the song" })),
      el("button", { class: "lf-close", text: "✕" })),
    el("div", { style: "display:flex;gap:8px;align-items:center;padding:10px 16px 0" },
      (function langSelect() {
        const sel = el("select", { class: "lf-input", style: "flex:1" },
          LANGS.map((l) => el("option", { value: l.code, text: l.label })));
        sel.value = lsGet(TR_LANG_KEY) || "en";
        sel.addEventListener("change", () => {
          lsSet(TR_LANG_KEY, sel.value);
          translateState = null;
          translateError = null;
          renderTranslatePanel();
        });
        return sel;
      })(),
      (function providerSelect() {
        const sel = el("select", { class: "lf-input", style: "width:auto" },
          el("option", { value: "liner", text: "Liner AI" }),
          el("option", { value: "google", text: "Google" }));
        sel.value = lsGet(TR_PROVIDER_KEY) || "liner";
        sel.addEventListener("change", () => {
          lsSet(TR_PROVIDER_KEY, sel.value);
          translateState = null;
          translateError = null;
          renderTranslatePanel();
        });
        return sel;
      })(),
      el("button", { class: "lf-btn", text: "Translate" })),
    el("div", { class: "lf-body lf-tr-body", style: "flex:1" }));
  (panel.querySelector(".lf-btn") as HTMLElement).addEventListener("click", async () => {
    if (translateBusy) return;
    const fan = currentLyrics();
    if (!fan) return;
    const lang = (panel.querySelector("select.lf-input") as HTMLSelectElement).value;
    const provider = (panel.querySelectorAll("select.lf-input")[1] as HTMLSelectElement).value;
    const cacheKey = trCacheKey(fan.trackId, lang, provider);
    const cached = lsGet(cacheKey);
    if (cached) {
      try {
        translateState = { fan, lang, provider, lines: JSON.parse(cached) as string[] };
        translateError = null;
        renderTranslatePanel();
        return;
      } catch { /* refetch */ }
    }
    translateBusy = true;
    translateError = null;
    renderTranslatePanel();
    const texts = fan.lines.map((l) => l.text);
    try {
      const lines = provider === "google"
        ? await translateWithGoogle(texts, lang)
        : await translateWithLiner(texts, lang);
      translateState = { fan, lang, provider, lines };
      lsSet(cacheKey, JSON.stringify(lines));
    } catch (err) {
      translateError = err instanceof Error ? err.message : String(err);
    } finally {
      translateBusy = false;
      renderTranslatePanel();
    }
  });
  panel.addEventListener("scroll", () => { userScrolledAt = Date.now(); }, true);
  translatePanel = panel;
  openLayer(panel);
  renderTranslatePanel();
}

// ---------------------------------------------------------------------------
// 3) lyric style themes
// ---------------------------------------------------------------------------

type ThemeDef = {
  id: string; name: string; category: string;
  family?: string; weight?: number; italic?: boolean; uppercase?: boolean;
  letterSpacing?: number;
  activeColor?: string; activeGradient?: [string, string];
  glowColor?: string; constantGlowRem?: number;
  inactiveAlpha?: number; inactiveBlurPx?: number;
  glitch?: boolean;
};

const SERIF = "Georgia,'Times New Roman','Noto Serif',ui-serif,serif";
const MONO = "'Geist Mono',ui-monospace,'SF Mono',monospace";

const THEMES: ThemeDef[] = [
  { id: "karaoke", name: "Karaoke", category: "Classic" },
  { id: "spread", name: "Spread", category: "Classic", letterSpacing: 5 },
  { id: "typewriter", name: "Typewriter", category: "Classic", family: MONO, weight: 700, letterSpacing: 1.5 },
  { id: "headline", name: "Headline", category: "Poster", uppercase: true, weight: 800, letterSpacing: 2 },
  { id: "shadow", name: "Shadow", category: "Nero", weight: 700, glowColor: "rgba(0,0,0,.85)", constantGlowRem: 1.1 },
  { id: "blur-italic", name: "Blur Italic", category: "Nero", family: SERIF, italic: true, weight: 500, inactiveBlurPx: 7, inactiveAlpha: .42, glowColor: "rgba(255,255,255,.45)", constantGlowRem: .5 },
  { id: "neon", name: "Neon", category: "Neon", activeColor: "#ff5fd2", glowColor: "#ff5fd2", constantGlowRem: .9 },
  { id: "echo", name: "Echo", category: "Neon", inactiveBlurPx: 4, inactiveAlpha: .2, glowColor: "rgba(255,255,255,.5)", constantGlowRem: .5 },
  { id: "glitch", name: "Glitch", category: "Neon", glitch: true },
  { id: "drift", name: "Drift", category: "Kinetic", uppercase: true, weight: 700, letterSpacing: 3, activeColor: "#7ad7ff", glowColor: "#39b7ff", constantGlowRem: .8 },
  { id: "bolt", name: "Bolt", category: "Kinetic", uppercase: true, weight: 900, activeColor: "#ffd166", glowColor: "#ff4d6d", constantGlowRem: 1 },
  { id: "candy", name: "Candy", category: "Poster", weight: 700, activeGradient: ["#ff6ec4", "#7873ff"], glowColor: "rgba(120,115,255,.55)", constantGlowRem: .6 },
];

const STYLE_KEY = "liner_web_lyric_style";
let overlay: HTMLElement | null = null;
let overlayTheme: ThemeDef | null = null;
let overlayFan: FanLyrics | null = null;
let overlayActiveIndex = -1;

function themeOf(id: string | null): ThemeDef | null {
  if (!id) return null;
  return THEMES.find((t) => t.id === id) ?? null;
}

function selectedTheme(): ThemeDef | null {
  return themeOf(lsGet(STYLE_KEY));
}

/** Large canvases = the beta's fullscreen lyrics stage. Hidden while the fan overlay is up. */
function betaLyricsCanvases(): HTMLCanvasElement[] {
  const vw = window.innerWidth, vh = window.innerHeight;
  return Array.from(doc.querySelectorAll("canvas")).filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > vw * 0.4 && r.height > vh * 0.35;
  });
}

function applyThemeCss(line: HTMLElement, theme: ThemeDef, active: boolean): void {
  const base = line.style;
  base.cssText = base.cssText.replace(/filter:[^;]+;?/g, "");
  base.fontFamily = theme.family ?? "Montserrat,Inter,system-ui,sans-serif";
  base.fontWeight = String(theme.weight ?? 600);
  base.fontStyle = theme.italic ? "italic" : "normal";
  base.textTransform = theme.uppercase ? "uppercase" : "none";
  base.fontSize = `${active ? 30 : 24}px`;
  if (theme.letterSpacing) base.letterSpacing = `${theme.letterSpacing}px`;
  const color = active ? (theme.activeColor ?? "#fff") : "#fff";
  const alpha = active ? 1 : (theme.inactiveAlpha ?? 0.3);
  const blur = !active && theme.inactiveBlurPx ? `filter:blur(${theme.inactiveBlurPx}px);` : "";
  const glow = active && theme.constantGlowRem
    ? `text-shadow:0 0 ${theme.constantGlowRem}rem ${theme.glowColor ?? color},0 0 ${theme.constantGlowRem * 2.4}rem ${theme.glowColor ?? color};`
    : "";
  const fringe = active && theme.glitch
    ? `text-shadow:-2px 0 rgba(255,0,80,.55),2px 0 rgba(0,255,255,.55);`
    : "";
  base.opacity = String(alpha);
  base.cssText += `${blur}${glow}${fringe}color:${color};`;
  if (active && theme.activeGradient) {
    base.cssText += `background:linear-gradient(90deg,${theme.activeGradient[0]},${theme.activeGradient[1]});-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;`;
  }
}

function renderOverlay(): void {
  if (!overlay || !overlayTheme || !overlayFan) return;
  const wrap = overlay.querySelector(".lf-lyrics") as HTMLElement;
  wrap.textContent = "";
  overlayActiveIndex = -1;
  const now = currentPositionSec();
  overlayFan.lines.forEach((line, i) => {
    const node = el("div", { class: "lf-line", text: line.text });
    const next = overlayFan!.lines[i + 1];
    const active = line.t != null && (line.t as number) <= now + 0.35 &&
      (!next || next.t == null || (next.t as number) > now + 0.35);
    applyThemeCss(node, overlayTheme!, active);
    if (active) overlayActiveIndex = i;
    if (line.t != null) {
      node.addEventListener("click", () => {
        const media = doc.querySelector("audio,video") as HTMLMediaElement | null;
        if (media) media.currentTime = line.t as number;
      });
    }
    wrap.appendChild(node);
  });
  scrollOverlayToActive(true);
}

function scrollOverlayToActive(force: boolean): void {
  if (!overlay || !overlayFan || overlayActiveIndex < 0) return;
  if (!force && !pos.playing) return;
  const wrap = overlay.querySelector(".lf-lyrics") as HTMLElement;
  const target = wrap.children[overlayActiveIndex] as HTMLElement | undefined;
  if (!target) return;
  const box = wrap.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const delta = rect.top + rect.height / 2 - (box.top + box.height * 0.42);
  if (Math.abs(delta) > 12) wrap.scrollTop += delta;
}

function tickOverlay(): void {
  if (!overlay || !overlayTheme || !overlayFan) return;
  const now = currentPositionSec();
  const lines = overlayFan.lines;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t != null && (lines[i].t as number) <= now + 0.35) active = i;
  }
  if (active !== overlayActiveIndex && active >= 0) {
    const previous = overlayActiveIndex;
    overlayActiveIndex = active;
    if (previous >= 0) applyThemeCss(wrapChild(previous), overlayTheme, false);
    applyThemeCss(wrapChild(active), overlayTheme, true);
    scrollOverlayToActive(false);
  }
}
function wrapChild(i: number): HTMLElement {
  return (overlay!.querySelector(".lf-lyrics") as HTMLElement).children[i] as HTMLElement;
}

function activateOverlay(theme: ThemeDef | null): void {
  deactivateOverlay();
  if (!theme) return;
  const fan = currentLyrics();
  overlayTheme = theme;
  overlayFan = fan;
  overlay = el("div", { class: "lf-overlay" },
    el("div", { class: "lf-lyrics" },
      fan ? undefined : el("div", { class: "lf-status", text: "Waiting for lyrics…" })));
  doc.body.appendChild(overlay);
  for (const c of betaLyricsCanvases()) {
    c.dataset.lfHidden = c.style.visibility || "";
    c.style.visibility = "hidden";
  }
  if (fan) renderOverlay();
}

function deactivateOverlay(): void {
  overlay?.remove();
  overlay = null;
  overlayTheme = null;
  overlayFan = null;
  overlayActiveIndex = -1;
  for (const c of betaLyricsCanvases()) {
    if ("lfHidden" in c.dataset) {
      c.style.visibility = c.dataset.lfHidden || "";
      delete c.dataset.lfHidden;
    }
  }
}

function openStyles(): void {
  const preview = (t: ThemeDef) => {
    const node = el("div", { class: "lf-theme-preview", text: "Midnight shine" });
    applyThemeCss(node, { ...t, activeGradient: undefined }, true);
    node.style.fontSize = "15px";
    node.style.opacity = "1";
    return node;
  };
  const grid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px" });
  const current = lsGet(STYLE_KEY);
  const original = el("div", { class: `lf-theme-card${current ? "" : " on"}` },
    el("div", { class: "lf-theme-name", text: "Original (beta)" }),
    el("div", { class: "lf-theme-cat", text: "The app's own canvas" }));
  original.addEventListener("click", () => {
    lsSet(STYLE_KEY, "");
    activateOverlay(null);
    openStyles();
  });
  grid.appendChild(original);
  for (const t of THEMES) {
    const card = el("div", { class: `lf-theme-card${current === t.id ? " on" : ""}` },
      el("div", { class: "lf-theme-name", text: t.name }),
      el("div", { class: "lf-theme-cat", text: t.category }),
      preview(t));
    card.addEventListener("click", () => {
      lsSet(STYLE_KEY, t.id);
      const fan = currentLyrics();
      if (fan && isPlayerVisible()) activateOverlay(t);
      openStyles();
    });
    grid.appendChild(card);
  }
  const panel = el("div", {
    class: "lf-panel",
    style: "width:min(560px,94vw);max-height:min(76vh,640px);left:50%;top:50%;transform:translate(-50%,-50%)",
  },
    el("div", { class: "lf-head" },
      el("div", {},
        el("h2", { text: "Lyric styles" }),
        el("div", { class: "lf-status", text: "Fan themes for the fullscreen lyrics — click a line to seek" })),
      el("button", { class: "lf-close", text: "✕" })),
    el("div", { class: "lf-body" }, grid));
  openLayer(panel);
}

// ---------------------------------------------------------------------------
// native injections — the beta's own surfaces, beta's own styling
// ---------------------------------------------------------------------------

/** Beta nav-rail icon button (44×36, rounded-9) with a History icon. */
function buildSidebarItem(): HTMLElement {
  const item = el("div", {
    "data-liner-fan": "changelog",
    class: "relative inline-flex items-center justify-center",
  });
  const button = el("button", {
    class: "group relative inline-flex h-[36px] w-[44px] items-center justify-center rounded-[9px] border-0 p-0 cursor-pointer active:scale-[0.96] transition-[background-color,transform] duration-150 bg-transparent hover:bg-white/[0.06]",
    "aria-label": "Changelog",
  });
  button.appendChild(svgIcon(ICON_HISTORY, "relative z-10 text-text-primary opacity-65 transition-opacity duration-150"));
  button.addEventListener("click", (e) => {
    e.preventDefault();
    openChangelog();
  });
  button.addEventListener("mouseenter", (e) => showTooltip("Changelog", e));
  button.addEventListener("mousemove", (e) => moveTooltip(e));
  button.addEventListener("mouseleave", hideTooltip);
  item.appendChild(button);
  const dot = el("span", {
    "data-liner-fan": "changelog-dot",
    style: "position:absolute;top:2px;right:3px;width:8px;height:8px;border-radius:50%;background:#8fe36b;border:1.5px solid rgba(0,0,0,.5);display:none;z-index:20",
  });
  item.appendChild(dot);
  return item;
}

let tooltipNode: HTMLElement | null = null;

function showTooltip(text: string, e: MouseEvent): void {
  hideTooltip();
  tooltipNode = el("div", { class: "lf-tooltip", text });
  doc.body.appendChild(tooltipNode);
  moveTooltip(e);
}
function moveTooltip(e: MouseEvent): void {
  if (!tooltipNode) return;
  const x = Math.min(e.clientX + 12, window.innerWidth - tooltipNode.offsetWidth - 8);
  tooltipNode.style.left = `${x}px`;
  tooltipNode.style.top = `${e.clientY - 34}px`;
}
function hideTooltip(): void {
  tooltipNode?.remove();
  tooltipNode = null;
}

function refreshSidebarDot(): void {
  const dot = doc.querySelector('[data-liner-fan="changelog-dot"]') as HTMLElement | null;
  if (dot) dot.style.display = changelogUnseen() ? "" : "none";
}

function injectSidebar(): void {
  const nav = doc.querySelector("nav");
  if (!nav) return;
  if (nav.querySelector('[data-liner-fan="changelog"]')) {
    refreshSidebarDot();
    return;
  }
  void loadChangelog().then(refreshSidebarDot);
  nav.appendChild(buildSidebarItem());
}

/** The fullscreen player's top-center lyrics-offset pill container. */
function offsetPillContainer(): HTMLElement | null {
  for (const d of doc.querySelectorAll("div")) {
    const cls = typeof d.className === "string" ? d.className : "";
    if (
      cls.includes("absolute") && cls.includes("top-1.5") &&
      cls.includes("left-1/2") && cls.includes("pointer-events-none") &&
      (d.textContent ?? "").includes("s")
    ) return d;
  }
  return null;
}

let playerTools: HTMLElement | null = null;

function buildPlayerTools(): HTMLElement {
  const container = el("div", {
    "data-liner-fan": "player-tools",
    class: "absolute top-[52px] left-1/2 -translate-x-1/2 z-30 flex justify-center pointer-events-none",
  });
  const pill = el("div", {
    class: "pointer-events-auto flex items-center gap-[2px] rounded-[11px] bg-black/45 backdrop-blur-[2px] px-[5px] py-[3px] text-white",
    style: "box-shadow:0 2px 10px rgba(0,0,0,.25)",
  });
  const chip = (label: string, icon: string, onClick: () => void) => {
    const c = el("button", {
      class: "flex items-center gap-[5px] h-[26px] px-[8px] rounded-[9px] border-0 bg-transparent text-white text-[12px] font-medium cursor-pointer transition-colors duration-150 hover:bg-white/10",
      "aria-label": label,
    });
    c.style.setProperty("color", "#fff");
    c.appendChild(svgIcon(icon, "shrink-0"));
    c.appendChild(doc.createTextNode(label));
    c.addEventListener("click", (e) => {
      e.preventDefault();
      onClick();
    });
    return c;
  };
  pill.appendChild(chip("AI Translate", ICON_TRANSLATE, openTranslate));
  pill.appendChild(chip("Styles", ICON_STYLES, openStyles));
  container.appendChild(pill);
  return container;
}

function injectPlayerTools(): void {
  const pill = offsetPillContainer();
  if (!pill) {
    playerTools?.remove();
    playerTools = null;
    return;
  }
  if (playerTools && playerTools.isConnected) return;
  const existing = pill.parentElement?.querySelector('[data-liner-fan="player-tools"]');
  if (existing) {
    playerTools = existing as HTMLElement;
    return;
  }
  playerTools = buildPlayerTools();
  pill.parentElement?.insertBefore(playerTools, pill.nextSibling);
}

// ---------------------------------------------------------------------------
// fullscreen-player visibility loop (drives the themes overlay)
// ---------------------------------------------------------------------------

let playerWasVisible = false;

function isPlayerVisible(): boolean {
  return betaLyricsCanvases().length > 0;
}

setInterval(() => {
  // consume shim-sniffed lyrics (raw SSE bodies) into the parsed registry
  const raw = w.__linerFanLyricsRaw;
  if (raw) {
    for (const [id, entry] of raw) {
      if (!w.__linerFanLyrics?.has(id)) ingestLyricsSse(entry.trackId, entry.body);
    }
  }
  const visible = isPlayerVisible();
  if (visible && !playerWasVisible) {
    const theme = selectedTheme();
    if (theme) activateOverlay(theme);
  } else if (!visible && playerWasVisible) {
    deactivateOverlay();
  }
  playerWasVisible = visible;
  if (overlay) tickOverlay();
  if (translatePanel && activePanel === translatePanel) syncTranslateScroll(false);
}, 500);

// track changed → refresh overlay + warm the lyrics registry
doc.addEventListener("liner-web-state", () => {
  if (overlay && overlayTheme) {
    const fan = currentLyrics();
    if (fan && fan.trackId !== overlayFan?.trackId) {
      overlayFan = fan;
      renderOverlay();
    }
  }
});
doc.addEventListener("liner-web-lyrics", (e) => {
  const id = (e as CustomEvent<string>).detail;
  if (overlay && overlayTheme && overlayFan?.trackId === id) {
    overlayFan = w.__linerFanLyrics?.get(id) ?? overlayFan;
    renderOverlay();
  }
  if (translatePanel && activePanel === translatePanel && currentTrackId() === id) renderTranslatePanel();
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

let scanScheduled = false;

function scanDom(): void {
  scanScheduled = false;
  try {
    injectSidebar();
    injectPlayerTools();
  } catch {
    /* injection is best-effort */
  }
}

function scheduleScan(): void {
  if (scanScheduled) return;
  scanScheduled = true;
  setTimeout(scanDom, 200);
}

function boot(): void {
  doc.head.appendChild(el("style", { id: "liner-fan-css", text: FAN_CSS }));
  scanDom();
  new MutationObserver(scheduleScan).observe(doc.body, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleScan);
  // fresh lyrics for the current track as soon as the app reports one
  setTimeout(() => {
    doc.dispatchEvent(new CustomEvent("liner-web-state"));
  }, 3000);
}

if (doc.readyState === "loading") {
  doc.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
