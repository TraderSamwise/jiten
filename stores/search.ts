import { create } from "zustand";
import type { DictEntry } from "@/db/types";

interface SearchState {
  results: DictEntry[];
  isSearching: boolean;
  setResults: (results: DictEntry[]) => void;
  setIsSearching: (isSearching: boolean) => void;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  results: [],
  isSearching: false,
  setResults: (results) => set({ results, isSearching: false }),
  setIsSearching: (isSearching) => set({ isSearching }),
  clear: () => set({ results: [], isSearching: false }),
}));
