import { useCallback, useEffect, useRef, useState } from "react";
import { useUserDb } from "@/db/user-provider";

export type WordFilterMode = "review" | "learn" | "all";

interface WordFilterState {
  reviewCount: number;
  learnCount: number;
  allCount: number;
  getFilteredEntryIds: (mode: WordFilterMode) => number[];
  refresh: () => void;
}

export function useWordFilter(listId: string | undefined): WordFilterState {
  const userDb = useUserDb();
  const [reviewCount, setReviewCount] = useState(0);
  const [learnCount, setLearnCount] = useState(0);
  const [allCount, setAllCount] = useState(0);

  const allEntryIdsRef = useRef<number[]>([]);
  const reviewedIdSetRef = useRef<Set<number>>(new Set());

  const load = useCallback(async () => {
    if (!userDb || !listId) return;

    const allRows = await userDb.getAllAsync<{ entry_id: number }>(
      "SELECT entry_id FROM list_entries WHERE list_id = ?",
      [listId],
    );
    const entryIds = allRows.map((r: { entry_id: number }) => r.entry_id);
    allEntryIdsRef.current = entryIds;
    setAllCount(entryIds.length);

    if (entryIds.length === 0) {
      reviewedIdSetRef.current = new Set();
      setReviewCount(0);
      setLearnCount(0);
      return;
    }

    const placeholders = entryIds.map(() => "?").join(",");
    const reviewRows = await userDb.getAllAsync<{ entry_id: number }>(
      `SELECT DISTINCT s.entry_id FROM srs_cards s
       WHERE s.list_id = ? AND s.entry_id IN (${placeholders})
       AND (s.simple_stage IS NOT NULL OR s.state != 0)`,
      [listId, ...entryIds],
    );

    const reviewedSet = new Set<number>(reviewRows.map((r: { entry_id: number }) => r.entry_id));
    reviewedIdSetRef.current = reviewedSet;
    setReviewCount(reviewedSet.size);
    setLearnCount(entryIds.length - reviewedSet.size);
  }, [userDb, listId]);

  useEffect(() => {
    load();
  }, [load]);

  const getFilteredEntryIds = useCallback((mode: WordFilterMode): number[] => {
    const all = allEntryIdsRef.current;
    const reviewed = reviewedIdSetRef.current;

    if (mode === "all") return [...all];
    if (mode === "review") return all.filter((id) => reviewed.has(id));
    return all.filter((id) => !reviewed.has(id)); // learn
  }, []);

  return {
    reviewCount,
    learnCount,
    allCount,
    getFilteredEntryIds,
    refresh: load,
  };
}
