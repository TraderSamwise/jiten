import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAtom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

export type SortMode = "list" | "added" | "freq" | "heisig" | "strokes";

export const SORT_LABELS: Record<SortMode, string> = {
  list: "List order",
  added: "Date added",
  freq: "Frequency",
  heisig: "Heisig (RTK)",
  strokes: "Stroke count",
};

/** Order the menu presents; kanji-only modes are filtered out for word lists. */
export const SORT_ORDER: SortMode[] = ["list", "added", "freq", "heisig", "strokes"];
export const KANJI_ONLY_MODES: readonly SortMode[] = ["heisig", "strokes"];

/** Dict-derived modes need a bulk key fetch + JS re-sort; the rest are plain SQL ORDER BY. */
export function isDictSort(mode: SortMode): boolean {
  return mode === "freq" || mode === "heisig" || mode === "strokes";
}

const storage = createJSONStorage<Record<string, SortMode>>(() => AsyncStorage);
const listSortModesAtom = atomWithStorage<Record<string, SortMode>>("listSortModes", {}, storage);

/** Per-list sort preference, persisted locally (view-only; does not affect study order). */
export function useListSortMode(listId: string | undefined): [SortMode, (mode: SortMode) => void] {
  const [modes, setModes] = useAtom(listSortModesAtom);
  const mode = (listId ? modes[listId] : undefined) ?? "list";
  const setMode = (next: SortMode) => {
    if (!listId) return;
    setModes((prev) => ({ ...prev, [listId]: next }));
  };
  return [mode, setMode];
}
