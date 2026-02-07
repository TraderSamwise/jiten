import { create } from "zustand";
import type { DictEntry } from "@/db/types";

interface SearchState {
  query: string;
  results: DictEntry[];
  isSearching: boolean;
  setQuery: (query: string) => void;
  setResults: (results: DictEntry[]) => void;
  setIsSearching: (isSearching: boolean) => void;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  results: [],
  isSearching: false,
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results, isSearching: false }),
  setIsSearching: (isSearching) => set({ isSearching }),
  clear: () => set({ query: "", results: [], isSearching: false }),
}));
