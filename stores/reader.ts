import { create } from "zustand";

interface ReaderState {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),
}));
