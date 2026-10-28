// AI lyrics translation providers — mirrors the Liner desktop "AI Translate"
// settings tab (OpenRouter / Gemini / OpenAI / Claude / Ollama) plus the free
// Google Translate endpoint as the zero-config default.
//
// Every provider is called through the shell proxy `/api/fetch?u=<url>` so
// CORS never blocks a browser call and API keys ride in Authorization headers
// the proxy already forwards. Ollama is the one exception: it runs on the
// user's own machine (localhost:11434), which the server cannot reach, so it
// is fetched directly from the browser.

import type { ComponentType } from "react";

export type AiProviderId =
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

// -- Inline brand logos (tiny, single-colour so they sit well on any theme) --

const GoogleLogo = ({ size = 18, className }: ProviderLogoProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
    />
  </svg>
);

const OpenRouterLogo = ({ size = 18, className }: ProviderLogoProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="currentColor"
      d="M16.8 2.5v6.9c0 .3-.34.49-.6.32l-2.1-1.4a.53.53 0 0 0-.3-.09h-1.3c-.18 0-.36.09-.46.25L10.9 10.3a.55.55 0 0 0 0 .56l1.14 1.87c.1.16.28.25.46.25h1.3c.11 0 .21-.03.3-.09l2.1-1.4c.26-.17.6.02.6.32v6.9c0 .42-.5.63-.8.34l-3.28-3.28a.53.53 0 0 0-.38-.16h-2.6c-.14 0-.28.06-.38.16l-3.28 3.28c-.3.3-.8.08-.8-.34v-6.9c0-.3.34-.49.6-.32l2.1 1.4c.09.06.19.09.3.09h1.56c.18 0 .36-.09.46-.25l1.14-1.87a.55.55 0 0 0 0-.56L10.84 8.4a.54.54 0 0 0-.46-.25H8.82c-.11 0-.21.03-.3.09l-2.1 1.4c-.26.17-.6-.02-.6-.32v-6.9c0-.42.5-.63.8-.34l3.28 3.28c.1.1.24.16.38.16h3.44c.14 0 .28-.06.38-.16l3.28-3.28c.3-.3.8-.08.8.34Z"
    />
  </svg>
);

const GeminiLogo = ({ size = 18, className }: ProviderLogoProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="liner-gemini-g" x1="0" y1="24" x2="24" y2="0">
        <stop offset="0" stopColor="#1C7DFF" />
        <stop offset="0.5" stopColor="#7A5CFF" />
        <stop offset="1" stopColor="#E34CFF" />
      </linearGradient>
    </defs>
    <path
      fill="url(#liner-gemini-g)"
      d="M12 1.5c.36 3.1 1.4 5.4 3.1 7.05 1.72 1.66 4.06 2.68 7.4 3.1v.7c-3.34.42-5.68 1.44-7.4 3.1-1.7 1.65-2.74 3.95-3.1 7.05h-.7c-.36-3.1-1.4-5.4-3.1-7.05-1.72-1.66-4.06-2.68-7.4-3.1v-.7c3.34-.42 5.68-1.44 7.4-3.1 1.7-1.65 2.74-3.95 3.1-7.05h.7Z"
    />
  </svg>
);

const OpenAiLogo = ({ size = 18, className }: ProviderLogoProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="currentColor"
      d="M21.55 9.82a5.4 5.4 0 0 0-.47-4.45 5.46 5.46 0 0 0-5.88-2.62A5.47 5.47 0 0 0 6.9.8a5.46 5.46 0 0 0-3.52 4.43 5.4 5.4 0 0 0-3.32 3.34 5.46 5.46 0 0 0 1.34 5.62 5.4 5.4 0 0 0 .47 4.44 5.46 5.46 0 0 0 5.88 2.62 5.46 5.46 0 0 0 8.3-3.4 5.4 5.4 0 0 0 3.32-3.35 5.46 5.46 0 0 0-1.34-5.61l.52-.07Zm-8.1 12.7a4.1 4.1 0 0 1-2.63-.95l.13-.08 4.37-2.52a.71.71 0 0 0 .36-.62v-6.16l1.85 1.06c.02.01.04.03.04.06v5.1a4.12 4.12 0 0 1-4.12 4.11ZM4.24 17.93a4.08 4.08 0 0 1-.5-2.76l.13.08 4.38 2.53a.71.71 0 0 0 .71 0l5.34-3.08v2.13a.07.07 0 0 1-.03.06L9.9 19.3a4.12 4.12 0 0 1-5.63-1.5l-.03.13ZM3.07 7.4a4.1 4.1 0 0 1 2.15-1.8v5.2c0 .26.13.5.35.62l5.31 3.07-1.85 1.06a.07.07 0 0 1-.07 0L4.6 13.15a4.12 4.12 0 0 1-1.5-5.63l-.03-.12Zm14.9 3.46-5.33-3.1L14.48 6.7a.07.07 0 0 1 .07 0l4.37 2.52a4.11 4.11 0 0 1-.63 7.42v-5.2a.72.72 0 0 0-.35-.62Zm1.92-2.9-.13-.08-4.37-2.55a.71.71 0 0 0-.72 0L9.34 8.41V6.28a.07.07 0 0 1 .03-.06l4.37-2.52a4.11 4.11 0 0 1 6.1 4.26h.05ZM8.3 12.87 6.45 11.8a.07.07 0 0 1-.04-.06V6.66a4.11 4.11 0 0 1 6.74-3.15l-.13.07-4.37 2.53a.71.71 0 0 0-.36.62v6.14.01Zm1-2.17 2.38-1.37 2.38 1.37v2.75l-2.37 1.37-2.38-1.37V10.7Z"
    />
  </svg>
);

const ClaudeLogo = ({ size = 18, className }: ProviderLogoProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#D97757"
      d="M6.36 15.62 10.72 13l.08-.22-.08-.13H10.5l-.73-.04-2.5-.08-2.17-.09-2.1-.12-.53-.1L2 11.44l.05-.32.44-.3.63.05 1.4.1 2.11.14 1.53.09 2.27.15h.36l.05-.15-.12-.08-.09-.08-2.19-1.48-2.37-1.58-1.24-.9-.67-.44-.34-.44-.15-.94.61-.67.82.06.21.06.83.64 1.86 1.44 2.43 1.79.35.28.14-.1.02-.07-.16-.26-1.32-2.38-1.4-2.43-.63-1-.17-.6a2.9 2.9 0 0 1-.1-.7l.69-.94 1.14-.03.86.24.36.8.58 1.32.9 2.2.55 1.24.32.7.17.64.06.19h.11V7.4l.15-.4.44-1.6.66-2.07.35-.76.55-.66.83-.14.66.3.5.72-.08.55-.3 1.28-.65 2.13-.63 2.05-.4 1.4v.21l.11.02.15-.19.83-1.1 1.4-1.75.66-.74.77-.8.5-.38h.94l.7 1.03-.32 1.1-.98 1.24-.82 1.07-1.18 1.59-.73 1.25.07.11.17-.02 2.07-.44 1.12-.2 1.3-.22.59.27.06.28-.23.6-1.47.36-1.72.35-2.56.6-.16.1.02.13.65.06.31.04h1.52l2.83.19.74.4.44.55-.08.43-1.13.57-1.52-.36-3.56-.85h-.15v.09l.98.96 1.8 1.63.9.97.05.44-.31.35-.46-.05-1.57-1.18-2.38-1.98-.35-.3-.14.05-.02.08.16.25 1.4 2.36.73 1.16.1.4-.28.5-.55-.08-1.2-1.68-1.24-1.9-.98-1.68-.1.06-.53 2.83-.26.97-.4 1.33-.28.36-.55-.02-.36-.83.16-.72.38-1.85.32-1.55.26-1.53-.15-.02-1.8 2.36-.97 1.18-1.08 1.1-.48.24-.42-.2.04-.55.24-.33 1.32-1.53.85-1.02.55-.72-.02-.13h-.07l-2.96 1.9-.78.32-.36.04-.32-.3.04-.5.19-.25.63-.43Z"
    />
  </svg>
);

const OllamaLogo = ({ size = 18, className }: ProviderLogoProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="currentColor"
      d="M7.05 2.02c-.9.04-1.63.42-2.13 1.1-.44.6-.66 1.4-.68 2.35-.02.83.06 1.52.34 2.4a9.4 9.4 0 0 0-1.06 4.32c0 1.24.32 2.4.9 3.42l-.03.08c-.35.2-.66.5-.86.9-.3.6-.3 1.3.02 2.07.42 1 .86 1.6 1.55 2.05.53.34 1.2.34 1.64-.02.38-.3.52-.82.4-1.42a5.8 5.8 0 0 1 1.4.42 9 9 0 0 0 3.46.66c1.2 0 2.35-.22 3.45-.66.5-.2 1-.33 1.42-.4-.12.58.02 1.1.4 1.4.44.36 1.1.36 1.64.02.7-.45 1.13-1.05 1.55-2.05.32-.77.32-1.46.02-2.06a1.9 1.9 0 0 0-.86-.9l-.03-.09a6.9 6.9 0 0 0 .9-3.41c0-1.56-.4-3.02-1.07-4.32.28-.88.36-1.57.34-2.4-.02-.95-.24-1.75-.68-2.36-.5-.67-1.23-1.05-2.13-1.09-1.04-.05-1.98.44-2.72 1.06a9.9 9.9 0 0 0-4.62 0C9.03 2.46 8.09 1.97 7.05 2.02Zm.13.92c.86-.04 1.68.36 2.4 1.06l-.4.16a8.9 8.9 0 0 0-3.7 3.02 5.5 5.5 0 0 1-.22-1.7c.02-.79.2-1.4.5-1.84.33-.44.8-.68 1.42-.7Zm9.64 0c.61.02 1.09.26 1.42.7.3.43.48 1.05.5 1.83.01.6-.07 1.16-.22 1.71a8.9 8.9 0 0 0-3.7-3.02l-.4-.16c.71-.7 1.53-1.1 2.4-1.06ZM12 4.63a8 8 0 0 1 5.5 2.13l.13.28c.36.8.6 1.66.7 2.53a4.7 4.7 0 0 0-1.46-.52 12.8 12.8 0 0 0-2.3-.25l-1.35-.02c-.5 0-.95.02-1.35.05-.87.05-1.62.13-2.3.26a4.7 4.7 0 0 0-1.46.52c.1-.87.34-1.72.7-2.53l.13-.28A8 8 0 0 1 12 4.63Zm-3.13 1.3c-.4.02-.73.15-.94.42-.2.26-.27.6-.2.98a1.5 1.5 0 0 0 .86 1.1c.44.22.94.26 1.4.1.4-.13.7-.37.85-.7a1.06 1.06 0 0 0-.08-1.03 1.8 1.8 0 0 0-.98-.75 2.2 2.2 0 0 0-.91-.12Zm6.26 0c-.3 0-.62.03-.91.12-.44.13-.79.4-.98.75-.2.32-.22.7-.08 1.03.15.33.44.57.85.7.46.16.96.12 1.4-.1.44-.22.75-.61.86-1.1.07-.38 0-.72-.2-.98-.21-.27-.54-.4-.94-.42Zm-6.09.87c.13 0 .28.03.42.08.24.09.43.24.5.4.07.13.06.22.02.3-.04.1-.15.2-.32.25-.2.07-.44.05-.64-.05-.2-.1-.34-.26-.38-.45-.03-.15 0-.25.06-.33.06-.08.18-.16.34-.2Zm5.92 0c.16.04.28.12.34.2.06.08.09.18.06.33a.63.63 0 0 1-.38.45c-.2.1-.44.12-.64.05-.17-.05-.28-.15-.32-.25-.04-.08-.05-.17.02-.3.07-.16.26-.31.5-.4.14-.05.29-.08.42-.08ZM12 10.05l1.7.02c.83.02 1.56.1 2.17.24.7.15 1.2.42 1.5.75.32.35.47.83.47 1.47 0 .9-.3 1.66-.92 2.35-.6.66-1.45 1.17-2.5 1.51a4.3 4.3 0 0 1-2.42.06 7.28 7.28 0 0 1-2.5-1.56 3.5 3.5 0 0 1-.93-2.36c0-.64.16-1.12.47-1.47.3-.33.8-.6 1.5-.75a10.7 10.7 0 0 1 2.17-.24l1.7-.02Zm-5.8.35c-.06.6-.09 1.2-.09 1.79 0 .42.03.83.1 1.23l-.13-.03a2.8 2.8 0 0 1-1.26-.78 3.4 3.4 0 0 1-.7-1.13 4.9 4.9 0 0 1-.2-1.32c.53-.36 1.36-.4 2.28-.24v.48Zm11.6 0 .01-.48c.92-.16 1.75-.12 2.28.24a4.9 4.9 0 0 1-.2 1.32c-.14.4-.37.79-.7 1.13-.36.37-.79.63-1.26.78l-.13.03c.07-.4.1-.81.1-1.23 0-.6-.03-1.2-.09-1.79Zm-5.86.9c-.34 0-.63.12-.85.36-.2.23-.31.52-.31.87 0 .34.1.63.3.86.23.24.52.36.86.36.33 0 .62-.12.84-.36.21-.23.32-.52.32-.86 0-.35-.11-.64-.32-.87a1.13 1.13 0 0 0-.84-.36Zm-3.94.06c-.28 0-.5.22-.5.5v.75a.5.5 0 1 0 1 0v-.75c0-.28-.22-.5-.5-.5Zm7.88 0c-.27 0-.5.22-.5.5v.75a.5.5 0 1 0 1 0v-.75c0-.28-.23-.5-.5-.5Zm-3.94 4.35c.5 0 1 .09 1.4.28.13.06.16.13.15.22 0 .1-.09.21-.24.3-.32.18-.8.25-1.31.25s-.99-.07-1.31-.25a.34.34 0 0 1-.24-.3c-.01-.09.02-.16.15-.22.4-.2.9-.28 1.4-.28Zm-6.4 1.1.14.05c.1.03.2.06.32.07-.16.38-.35.68-.58.9-.28.28-.6.44-1 .5.03-.22.1-.45.2-.7.22-.55.53-.83.92-.83Zm12.8 0c.39 0 .7.28.92.82.1.26.17.49.2.71-.4-.06-.72-.22-1-.5a2.7 2.7 0 0 1-.58-.9c.11 0 .22-.03.32-.06l.14-.06Z"
    />
  </svg>
);

export const AI_PROVIDERS: AiProviderDef[] = [
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
