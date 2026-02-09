import { create } from "zustand";
import type { SearchResults, GlossGroup } from "@/db/types";

const EMPTY_RESULTS: SearchResults = { japanese: [], english: [] };

interface SearchState {
  query: string;
  results: SearchResults;
  isSearching: boolean;
  selectedGlossGroup: GlossGroup | null;
  setQuery: (query: string) => void;
  setResults: (results: SearchResults) => void;
  setIsSearching: (isSearching: boolean) => void;
  setSelectedGlossGroup: (group: GlossGroup | null) => void;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  results: EMPTY_RESULTS,
  isSearching: false,
  selectedGlossGroup: null,
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results, isSearching: false }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setSelectedGlossGroup: (selectedGlossGroup) => set({ selectedGlossGroup }),
  clear: () => set({ query: "", results: EMPTY_RESULTS, isSearching: false, selectedGlossGroup: null }),
}));
