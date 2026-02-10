import { create } from "zustand";
import type { WordList, CardFace } from "@/db/types";

interface ListsState {
  lists: WordList[];
  setLists: (lists: WordList[]) => void;
  addList: (list: WordList) => void;
  removeList: (id: string) => void;
  updateList: (id: string, updates: Partial<WordList>) => void;
}

export function parseListRow(row: any): WordList {
  const rawFront = row.frontFaces ?? row.front_faces;
  const rawBack = row.backFaces ?? row.back_faces;
  return {
    ...row,
    configured: Boolean(row.configured ?? 0),
    flashcardMode: row.flashcardMode ?? row.flashcard_mode ?? "add_order",
    frontFaces:
      typeof rawFront === "string" ? (JSON.parse(rawFront) as CardFace[]) : (rawFront ?? ["kanji"]),
    backFaces:
      typeof rawBack === "string" ? (JSON.parse(rawBack) as CardFace[]) : (rawBack ?? ["english"]),
    studyPosition: row.studyPosition ?? row.study_position ?? 0,
  };
}

export const useListsStore = create<ListsState>((set) => ({
  lists: [],
  setLists: (lists) => set({ lists }),
  addList: (list) => set((state) => ({ lists: [...state.lists, list] })),
  removeList: (id) => set((state) => ({ lists: state.lists.filter((l) => l.id !== id) })),
  updateList: (id, updates) =>
    set((state) => ({
      lists: state.lists.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    })),
}));
