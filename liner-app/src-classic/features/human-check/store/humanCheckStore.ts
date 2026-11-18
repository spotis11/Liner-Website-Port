import { create } from "zustand";
import { setHumanCheckPrompt, type HumanCheckRequest } from "@classic/shared/api";

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
  skip: () => void;
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
    // The web renders the popup flow (CheckWindow inside CheckFrame) and the
    // desktop renders the iframe — both start in "loading" and drive the
    // phase from their own UI; no preblocking needed any more.
    set((state) => ({
      request,
      phase: "loading",
      attempt: state.attempt + 1,
      errorCode: null,
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

  // "Try without verification" — resolve with "" so the caller proceeds
  // without a token (upstream only sometimes enforces the check)
  skip: () => {
    set({ request: null });
    finish("");
  },
}));

setHumanCheckPrompt((request) => useHumanCheckStore.getState().open(request));
