import { create } from "zustand";
import { atom } from "jotai";

export type LibraryTab = "books" | "articles";

export const libraryTabAtom = atom<LibraryTab>("books");

interface ReaderState {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),
}));
