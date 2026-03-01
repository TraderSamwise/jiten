import { create } from "zustand";
import type { SearchResults, GlossGroup, KanjiCharacter, NameEntry } from "@/db/types";
import type { NameFilter } from "@/db/name-search";

export type SearchMode = "normal" | "kanji" | "radical" | "names";

const EMPTY_RESULTS: SearchResults = { japanese: [], english: [] };

interface SearchState {
  query: string;
  results: SearchResults;
  isSearching: boolean;
  selectedGlossGroup: GlossGroup | null;
  searchMode: SearchMode;
  kanjiResults: KanjiCharacter[];
  nameResults: NameEntry[];
  nameFilter: NameFilter;
  selectedRadicals: string[];
  setQuery: (query: string) => void;
  setResults: (results: SearchResults) => void;
  setIsSearching: (isSearching: boolean) => void;
  setSelectedGlossGroup: (group: GlossGroup | null) => void;
  setSearchMode: (mode: SearchMode) => void;
  setKanjiResults: (results: KanjiCharacter[]) => void;
  setNameResults: (results: NameEntry[]) => void;
  setNameFilter: (filter: NameFilter) => void;
  toggleRadical: (radical: string) => void;
  setSelectedRadicals: (radicals: string[]) => void;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  results: EMPTY_RESULTS,
  isSearching: false,
  selectedGlossGroup: null,
  searchMode: "normal",
  kanjiResults: [],
  nameResults: [],
  nameFilter: "all" as NameFilter,
  selectedRadicals: [],
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results, isSearching: false }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setSelectedGlossGroup: (selectedGlossGroup) => set({ selectedGlossGroup }),
  setSearchMode: (searchMode) =>
    set({
      searchMode,
      kanjiResults: [],
      nameResults: [],
      nameFilter: "all",
      selectedRadicals: [],
      query: "",
    }),
  setKanjiResults: (kanjiResults) => set({ kanjiResults, isSearching: false }),
  setNameResults: (nameResults) => set({ nameResults, isSearching: false }),
  setNameFilter: (nameFilter) => set({ nameFilter }),
  toggleRadical: (radical) =>
    set((state) => ({
      selectedRadicals: state.selectedRadicals.includes(radical)
        ? state.selectedRadicals.filter((r) => r !== radical)
        : [...state.selectedRadicals, radical],
    })),
  setSelectedRadicals: (selectedRadicals) => set({ selectedRadicals }),
  clear: () =>
    set({
      query: "",
      results: EMPTY_RESULTS,
      isSearching: false,
      selectedGlossGroup: null,
      kanjiResults: [],
      nameResults: [],
      nameFilter: "all",
      selectedRadicals: [],
    }),
}));
