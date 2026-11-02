import { create } from "zustand";
import type { MaintenanceStatus } from "../lib/maintenanceApi";

/**
 * Website-port maintenance wall state. When `active` is true the
 * MaintenanceGate renders the full-screen maintenance overlay over the
 * entire app (login included) and playback has been paused.
 *
 * The active state is mirrored into localStorage so the wall SURVIVES page
 * reloads (normal and hard): a browser that has been shown the maintenance
 * page keeps seeing it on boot, before and even without any network probe.
 * Only the website backend can release it — an authoritative
 * `enabled: false` — while a failed/timeout probe keeps an already-raised
 * wall up (fail-closed, exactly like the ban gate).
 */
export type MaintenanceState = {
  active: boolean;
  reasons: string[];
  setActive: (status: MaintenanceStatus) => void;
  clearActive: () => void;
};

const STORAGE_KEY = "liner_web_maintenance_v1";

/** Sanitize a persisted reasons list. */
function cleanReasons(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .slice(0, 8);
}

/** Read the persisted wall back, ignoring corrupt records. */
export function readPersistedMaintenance(
  storage: Storage | null,
): { active: boolean; reasons: string[] } {
  if (!storage) return { active: false, reasons: [] };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { active: false, reasons: [] };
    const parsed = JSON.parse(raw) as Partial<MaintenanceStatus> | null;
    if (!parsed || typeof parsed !== "object") return { active: false, reasons: [] };
    return {
      active: parsed.enabled === true,
      reasons: cleanReasons(parsed.reasons),
    };
  } catch {
    return { active: false, reasons: [] };
  }
}

function writePersistedMaintenance(
  storage: Storage | null,
  status: MaintenanceStatus | null,
): void {
  if (!storage) return;
  try {
    if (!status) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    const record = {
      enabled: status.enabled === true,
      reasons: cleanReasons(status.reasons),
      updatedAt: typeof status.updatedAt === "string" ? status.updatedAt : "",
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // private mode / quota errors must never break the gate
  }
}

export function createMaintenanceStore(
  storage: Storage | null = typeof window === "undefined" ? null : window.localStorage,
) {
  return create<MaintenanceState>((set) => ({
    // Synchronous hydration: the wall is up on the very first paint, before
    // any probe has a chance to flash the app.
    ...readPersistedMaintenance(storage),
    setActive: (status) => {
      writePersistedMaintenance(storage, status);
      set({ active: true, reasons: cleanReasons(status.reasons) });
    },
    clearActive: () => {
      writePersistedMaintenance(storage, null);
      set({ active: false, reasons: [] });
    },
  }));
}

export const useMaintenanceStore = createMaintenanceStore();

/**
 * What the gate does with a status probe answer. Kept pure for tests:
 *  - "wall"    → the server confirms maintenance (raise/refresh the wall);
 *  - "release" → the server authoritatively answered "not maintaining" —
 *                drop the wall.
 * Probe TRANSPORT failures never reach this function — the gate simply does
 * nothing then, so an already-raised wall stays up.
 */
export type MaintenanceGateDecision =
  | { action: "wall"; reasons: string[] }
  | { action: "release" };

export function decideMaintenanceAction(
  status: MaintenanceStatus,
): MaintenanceGateDecision {
  if (status.enabled) {
    return { action: "wall", reasons: status.reasons };
  }
  return { action: "release" };
}
