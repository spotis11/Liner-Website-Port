import { create } from "zustand";

interface ChangelogState {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
  toggleOpen: () => void;
}

export const useChangelogStore = create<ChangelogState>()((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
}));
