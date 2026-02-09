import { create } from "zustand";
import type { SearchResults } from "@/db/types";

const EMPTY_RESULTS: SearchResults = { japanese: [], english: [] };

interface SearchState {
  query: string;
  results: SearchResults;
  isSearching: boolean;
  setQuery: (query: string) => void;
  setResults: (results: SearchResults) => void;
  setIsSearching: (isSearching: boolean) => void;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  results: EMPTY_RESULTS,
  isSearching: false,
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results, isSearching: false }),
  setIsSearching: (isSearching) => set({ isSearching }),
  clear: () => set({ query: "", results: EMPTY_RESULTS, isSearching: false }),
}));
