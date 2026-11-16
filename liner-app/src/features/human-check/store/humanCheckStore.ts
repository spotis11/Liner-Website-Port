import { create } from "zustand";
import {
  humanCheckFrameBlocked,
  setHumanCheckPrompt,
  type HumanCheckRequest,
} from "@/shared/api";

export type HumanCheckPhase = "loading" | "ready" | "expired" | "error";

interface HumanCheckState {
  request: HumanCheckRequest | null;
  phase: HumanCheckPhase;
  attempt: number;
  errorCode: string | null;
  open: (request: HumanCheckRequest) => Promise<string | null>;
  setPhase: (phase: HumanCheckPhase) => void;
  fail: (code?: string) => void;
  solve: (token: string) => void;
  retry: () => void;
  cancel: () => void;
}

let settle: ((token: string | null) => void) | null = null;

function finish(token: string | null) {
  const done = settle;
  settle = null;
  done?.(token);
}

export const useHumanCheckStore = create<HumanCheckState>((set) => ({
  request: null,
  phase: "loading",
  attempt: 0,
  errorCode: null,

  open: (request) => {
    finish(null);
    // On the web port the widget is unreachable (WAF 403 + X-Frame-Options
    // + domain lock) — open straight in the failed state so the guidance is
    // visible immediately instead of a 25s dead frame. The iframe still
    // mounts via "Try again", which is the recovery gamble for networks
    // that do clear the WAF.
    const preblocked = humanCheckFrameBlocked();
    set((state) => ({
      request,
      phase: preblocked ? "error" : "loading",
      attempt: state.attempt + 1,
      errorCode: preblocked ? "110200" : null,
    }));
    return new Promise((resolve) => {
      settle = resolve;
    });
  },

  setPhase: (phase) => set({ phase }),

  fail: (code) => set({ phase: "error", errorCode: code ?? null }),

  solve: (token) => {
    set({ request: null });
    finish(token);
  },

  retry: () =>
    set((state) => ({
      phase: "loading",
      attempt: state.attempt + 1,
      errorCode: null,
    })),

  cancel: () => {
    set({ request: null });
    finish(null);
  },
}));

setHumanCheckPrompt((request) => useHumanCheckStore.getState().open(request));
