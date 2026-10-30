import likesCoverSvg from "@/assets/likes-cover.svg?raw";
import { rgbToHsl, hslToRgb } from "@/shared/lib/color";
import type { FluidColors } from "@/features/home/lib/extractFluidColors";

const STOP_INNER = "#111224";
const STOP_OUTER = "#433277";
const GLOW_BOTTOM = "#4D71FF";
const GLOW_TOP = "#7A4DFF";
const GLOW_LEFT = "#534DFF";
const SHADE = 'fill="black" fill-opacity="0.2"';

function parseRgb(value: string): [number, number, number] {
  const parts = value.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function toHex(h: number, s: number, l: number): string {
  const wrapped = ((h % 1) + 1) % 1;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return `#${hslToRgb(wrapped, clamp(s), clamp(l))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

export interface ImageTone {
  luminance: number;
  colorfulness: number;
}

export const DARK_TONE: ImageTone = { luminance: 0, colorfulness: 0 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export function toneFromPixels(data: ArrayLike<number>): ImageTone {
  let luma = 0;
  let sat = 0;
  let pixels = 0;
  let saturatedPixels = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    pixels++;
    luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const [, s, l] = rgbToHsl(r, g, b);
    if (l > 0.1 && l < 0.9) {
      sat += s;
      saturatedPixels++;
    }
  }

  if (pixels === 0) return DARK_TONE;
  return {
    luminance: luma / pixels,
    colorfulness: saturatedPixels ? (sat / saturatedPixels) * (saturatedPixels / pixels) : 0,
  };
}

export function measureImageTone(img: HTMLImageElement): ImageTone {
  try {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return DARK_TONE;
    ctx.drawImage(img, 0, 0, size, size);
    return toneFromPixels(ctx.getImageData(0, 0, size, size).data);
  } catch {
    return DARK_TONE;
  }
}

export function vividness({ luminance, colorfulness }: ImageTone): number {
  const brightness = clamp01((luminance - 0.18) / 0.3);
  const color = clamp01(colorfulness / 0.4);
  return brightness * (0.35 + 0.65 * color);
}

export function buildLikesCoverSvg(
  { color1, color2 }: FluidColors,
  tone: ImageTone = DARK_TONE,
): string {
  const [h1, s1] = rgbToHsl(...parseRgb(color1));
  const [h2, s2] = rgbToHsl(...parseRgb(color2));
  const t = vividness(tone);
  const shade = lerp(0.45, 0.12, t).toFixed(2);

  return likesCoverSvg
    .replace(SHADE, `fill="black" fill-opacity="${shade}"`)
    .replaceAll(STOP_INNER, toHex(h2, s2 * lerp(0.4, 0.85, t), lerp(0.03, 0.2, t)))
    .replaceAll(STOP_OUTER, toHex(h2, s2 * lerp(0.6, 0.95, t), lerp(0.16, 0.42, t)))
    .replaceAll(GLOW_BOTTOM, toHex(h2, s2 * lerp(0.8, 1, t), lerp(0.42, 0.58, t)))
    .replaceAll(GLOW_TOP, toHex(h2 + 0.06, s2 * lerp(0.8, 1, t), lerp(0.4, 0.62, t)))
    .replaceAll(GLOW_LEFT, toHex(h1, Math.max(s1, 0.4), lerp(0.36, 0.5, t)));
}

const STOCK_COLORS: FluidColors = {
  color1: "rgb(83, 77, 255)",
  color2: "rgb(122, 77, 255)",
  logoColor: "rgb(255, 255, 255)",
};
const HEART = 'fill="white" fill-opacity="0.7"';
const LIGHT_SHADE = 'fill="white" fill-opacity="0.15"';
const LIGHT_HEART = 'fill="white" fill-opacity="0.92"';

export function buildLightLikesCoverSvg({ color1, color2 }: FluidColors = STOCK_COLORS): string {
  const [h1, s1] = rgbToHsl(...parseRgb(color1));
  const [h2, s2] = rgbToHsl(...parseRgb(color2));

  return likesCoverSvg
    .replace(SHADE, LIGHT_SHADE)
    .replace(HEART, LIGHT_HEART)
    .replaceAll(STOP_INNER, toHex(h1, s1 * 0.55, 0.84))
    .replaceAll(STOP_OUTER, toHex(h2, s2 * 0.6, 0.7))
    .replaceAll(GLOW_BOTTOM, toHex(h2, s2 * 0.9, 0.62))
    .replaceAll(GLOW_TOP, toHex(h2 + 0.06, s2 * 0.9, 0.66))
    .replaceAll(GLOW_LEFT, toHex(h1, Math.max(s1, 0.5), 0.6));
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
