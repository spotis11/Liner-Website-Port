import { create } from "zustand";

/**
 * Sidebar collapse state for the Liner new UI. Persisted in localStorage so
 * the rail comes back the way the user left it (same pattern as the
 * fullscreen lyrics toggle).
 */
const STORAGE_KEY = "liner.sidebar.collapsed";

interface SidebarCollapseState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

function readPersistedCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // storage unavailable — the toggle still works for this session
  }
}

export const useSidebarCollapseStore = create<SidebarCollapseState>()(
  (set, get) => ({
    collapsed: readPersistedCollapsed(),
    toggleCollapsed: () => {
      const next = !get().collapsed;
      persistCollapsed(next);
      set({ collapsed: next });
    },
    setCollapsed: (collapsed) => {
      persistCollapsed(collapsed);
      set({ collapsed });
    },
  }),
);
