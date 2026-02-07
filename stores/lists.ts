import { create } from "zustand";
import type { WordList } from "@/db/types";

interface ListsState {
  lists: WordList[];
  setLists: (lists: WordList[]) => void;
  addList: (list: WordList) => void;
  removeList: (id: string) => void;
  updateList: (id: string, updates: Partial<WordList>) => void;
}

export const useListsStore = create<ListsState>((set) => ({
  lists: [],
  setLists: (lists) => set({ lists }),
  addList: (list) => set((state) => ({ lists: [...state.lists, list] })),
  removeList: (id) =>
    set((state) => ({ lists: state.lists.filter((l) => l.id !== id) })),
  updateList: (id, updates) =>
    set((state) => ({
      lists: state.lists.map((l) =>
        l.id === id ? { ...l, ...updates } : l
      ),
    })),
}));
