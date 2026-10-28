// AI lyrics translation providers — the Liner desktop "AI Translate" set
// (OpenRouter / Gemini / OpenAI / Claude / Ollama) plus the free Google
// Translate endpoint and Liner AI, the built-in server-side translator that
// needs no key and works for everyone.
//
// Logos are the REAL brand marks: the Liner logo itself for Liner AI, the
// official coloured Google Translate and Gemini SVGs plus the official
// OpenRouter / OpenAI / Claude / Ollama brand glyphs, vendored under ./logos
// (see scripts/vendor_ai_logos.py).
//
// Every remote provider is called through the shell proxy `/api/fetch?u=<url>`
// (or its own dedicated route) so CORS never blocks a browser call and API
// keys ride in Authorization headers the proxy already forwards. Ollama is the
// one exception: it runs on the user's own machine (localhost:11434), which
// the server cannot reach, so it is fetched directly from the browser.

import type { ComponentType } from "react";
import linerMarkSvg from "./logos/liner-mark.svg?raw";
import googleTranslateSvg from "./logos/google-translate.svg?raw";
import geminiSvg from "./logos/gemini.svg?raw";
import openrouterSvg from "./logos/openrouter.svg?raw";
import openaiSvg from "./logos/openai.svg?raw";
import claudeSvg from "./logos/claude.svg?raw";
import ollamaSvg from "./logos/ollama.svg?raw";

export type AiProviderId =
  | "liner"
  | "google"
  | "openrouter"
  | "gemini"
  | "openai"
  | "claude"
  | "ollama";

export interface ProviderLogoProps {
  size?: number;
  className?: string;
}

export interface AiProviderDef {
  id: AiProviderId;
  label: string;
  /** short hint shown under the key field */
  keyHint?: string;
  /** whether an API key is required */
  needsKey: boolean;
  /** whether a model id is configurable */
  needsModel: boolean;
  defaultModel: string;
  /** placeholder for the base URL override (Ollama) */
  baseUrlHint?: string;
  Logo: ComponentType<ProviderLogoProps>;
  /** free / zero-config providers can be the default */
  free: boolean;
}

// -- Real brand logos (vendored official SVGs) --------------------------------

/** Renders a vendored official brand SVG, sized by the wrapper.
 *  `ratio` widens the box for non-square marks (e.g. the 45×35 Liner logo) —
 *  the inner SVG letter-boxes itself via preserveAspectRatio. */
function BrandLogo({
  svg,
  size = 18,
  className,
  ratio = 1,
}: ProviderLogoProps & { svg: string; ratio?: number }) {
  return (
    <span
      className={`liner-brand-logo inline-block shrink-0 leading-none ${className ?? ""}`}
      style={{ width: Math.round(size * ratio * 100) / 100, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-hidden="true"
    />
  );
}

// Official coloured Google Translate logo (Wikimedia Commons, brand colours).
const GoogleLogo = ({ size, className }: ProviderLogoProps) => (
  <BrandLogo svg={googleTranslateSvg} size={size} className={className} />
);

// Official Gemini sparkle (2025 icon, multi-colour gradient).
const GeminiLogo = ({ size, className }: ProviderLogoProps) => (
  <BrandLogo svg={geminiSvg} size={size} className={className} />
);

// Official brand glyphs — monochrome marks coloured via CSS currentColor
// (Claude carries its official #D97757 orange inside the vendored file).
const OpenRouterLogo = ({ size, className }: ProviderLogoProps) => (
  <BrandLogo svg={openrouterSvg} size={size} className={className} />
);

const OpenAiLogo = ({ size, className }: ProviderLogoProps) => (
  <BrandLogo svg={openaiSvg} size={size} className={className} />
);

const ClaudeLogo = ({ size, className }: ProviderLogoProps) => (
  <BrandLogo svg={claudeSvg} size={size} className={className} />
);

const OllamaLogo = ({ size, className }: ProviderLogoProps) => (
  <BrandLogo svg={ollamaSvg} size={size} className={className} />
);

// Liner AI — built-in translator: the Liner logo itself (the same mark as the
// sidebar / login screen), coloured via currentColor so it fits any theme.
const LinerAiLogo = ({ size, className }: ProviderLogoProps) => (
  <BrandLogo svg={linerMarkSvg} size={size} className={className} ratio={45 / 35} />
);

export const AI_PROVIDERS: AiProviderDef[] = [
  {
    id: "liner",
    label: "Liner AI",
    needsKey: false,
    needsModel: false,
    defaultModel: "",
    Logo: LinerAiLogo,
    free: true,
  },
  {
    id: "google",
    label: "Google Translate",
    needsKey: false,
    needsModel: false,
    defaultModel: "",
    Logo: GoogleLogo,
    free: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyHint: "sk-or-...",
    needsKey: true,
    needsModel: true,
    defaultModel: "google/gemini-2.0-flash-001",
    Logo: OpenRouterLogo,
    free: false,
  },
  {
    id: "gemini",
    label: "Gemini",
    keyHint: "AIza...",
    needsKey: true,
    needsModel: true,
    defaultModel: "gemini-2.0-flash",
    Logo: GeminiLogo,
    free: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    keyHint: "sk-...",
    needsKey: true,
    needsModel: true,
    defaultModel: "gpt-4o-mini",
    Logo: OpenAiLogo,
    free: false,
  },
  {
    id: "claude",
    label: "Claude",
    keyHint: "sk-ant-...",
    needsKey: true,
    needsModel: true,
    defaultModel: "claude-3-5-haiku-latest",
    Logo: ClaudeLogo,
    free: false,
  },
  {
    id: "ollama",
    label: "Ollama",
    needsKey: false,
    needsModel: true,
    defaultModel: "llama3.2",
    baseUrlHint: "http://localhost:11434",
    Logo: OllamaLogo,
    free: false,
  },
];

export function getProviderDef(id: AiProviderId): AiProviderDef {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}
