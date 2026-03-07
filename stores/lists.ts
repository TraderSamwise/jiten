import { create } from "zustand";
import type { WrappedUserDb } from "@/db/user-db";
import type { WordList, CardFace, ListItem } from "@/db/types";

type ListEntryRow = { entry_id: number; kanji_literal: string | null };

export interface ListScrollCache {
  scrollOffset: number;
  items: ListItem[];
  allRows: ListEntryRow[];
  loadedCount: number;
  totalCount: number;
}

interface ListsState {
  lists: WordList[];
  listsLoaded: boolean;
  load: (userDb: WrappedUserDb) => Promise<void>;
  setLists: (lists: WordList[]) => void;
  addList: (list: WordList) => void;
  removeList: (id: string) => void;
  updateList: (id: string, updates: Partial<WordList>) => void;
  scrollCache: Record<string, ListScrollCache>;
  setScrollCache: (listId: string, partial: Partial<ListScrollCache>) => void;
  getScrollCache: (listId: string) => ListScrollCache | undefined;
  clearScrollCache: (listId: string) => void;
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
    autoPlayAudio: Boolean(row.autoPlayAudio ?? row.auto_play_audio ?? 0),
    confusionDetection: (row.confusionDetection ?? row.confusion_detection ?? 1) !== 0,
    voiceMode: Boolean(row.voiceMode ?? row.voice_mode ?? 0),
    typingMode: Boolean(row.typingMode ?? row.typing_mode ?? 0),
    disableFlipAnimation: Boolean(row.disableFlipAnimation ?? row.disable_flip_animation ?? 0),
    disableSwipeAnimation: Boolean(row.disableSwipeAnimation ?? row.disable_swipe_animation ?? 0),
    isDefault: Boolean(row.isDefault ?? row.is_default ?? 0),
  };
}

export const useListsStore = create<ListsState>((set, get) => ({
  lists: [],
  listsLoaded: false,
  load: async (userDb) => {
    const rows = await userDb.getAllAsync<WordList & { entryCount: number }>(
      `SELECT l.*, COUNT(le.id) as entryCount
       FROM lists l LEFT JOIN list_entries le ON l.id = le.list_id AND le.deleted_at IS NULL
       WHERE l.deleted_at IS NULL
       GROUP BY l.id ORDER BY l.created_at DESC`,
    );
    type SrsProgress = { list_id: string; total: number; learned: number; learning: number };
    const srsRows = await userDb.getAllAsync<SrsProgress>(
      `SELECT list_id,
        COUNT(*) as total,
        SUM(CASE WHEN state = 2 OR simple_stage = 1 THEN 1 ELSE 0 END) as learned,
        SUM(CASE WHEN state IN (1, 3) OR simple_stage = 0 THEN 1 ELSE 0 END) as learning
       FROM srs_cards
       WHERE deleted_at IS NULL
       GROUP BY list_id`,
    );
    const srsMap = new Map<string, SrsProgress>(srsRows.map((r) => [r.list_id, r]));
    set({
      lists: rows.map((row) => {
        const parsed = parseListRow(row);
        const srs = srsMap.get(parsed.id);
        if (srs) {
          parsed.studyProgress = {
            learned: srs.learned,
            learning: srs.learning,
            unlearned: (parsed.entryCount ?? 0) - srs.learned - srs.learning,
          };
        } else if (
          parsed.configured &&
          parsed.flashcardMode === "add_order" &&
          parsed.studyPosition > 0
        ) {
          parsed.studyProgress = {
            learned: parsed.studyPosition,
            learning: 0,
            unlearned: (parsed.entryCount ?? 0) - parsed.studyPosition,
          };
        }
        return parsed;
      }),
      listsLoaded: true,
    });
  },
  setLists: (lists) => set({ lists, listsLoaded: true }),
  addList: (list) => set((state) => ({ lists: [...state.lists, list] })),
  removeList: (id) => set((state) => ({ lists: state.lists.filter((l) => l.id !== id) })),
  updateList: (id, updates) =>
    set((state) => ({
      lists: state.lists.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    })),
  scrollCache: {},
  setScrollCache: (listId, partial) =>
    set((state) => ({
      scrollCache: {
        ...state.scrollCache,
        [listId]: { ...state.scrollCache[listId], ...partial } as ListScrollCache,
      },
    })),
  getScrollCache: (listId) => get().scrollCache[listId],
  clearScrollCache: (listId) =>
    set((state) => {
      const { [listId]: _, ...rest } = state.scrollCache;
      return { scrollCache: rest };
    }),
}));
