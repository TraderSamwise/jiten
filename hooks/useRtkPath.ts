import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { loadUnitShapes } from "@/db/rtk-frames";
import { crownsFromProgress, loadCourseProgress } from "@/db/rtk-progress";
import { pathSummary, type PathSummary, type UnitShape } from "@/lib/rtk-course";

/**
 * The 56 unit shapes never change, so the path pays for them once per database.
 * Keyed by the db object, so reopening it re-reads; and the mini and full
 * dictionaries agree on the shape anyway (both 56 units, 2,200 frames).
 */
const shapeCache = new WeakMap<object, UnitShape[]>();

async function unitShapes(dictDb: Parameters<typeof loadUnitShapes>[0]): Promise<UnitShape[]> {
  const cached = shapeCache.get(dictDb);
  if (cached) return cached;
  const shapes = await loadUnitShapes(dictDb);
  shapeCache.set(dictDb, shapes);
  return shapes;
}

export interface RtkPath {
  /** null until the first load finishes. */
  summary: PathSummary | null;
  /** No dictionary, or a dictionary with no RTK data: there is no course to show. */
  unavailable: boolean;
}

/**
 * The whole course's progress, reloaded on every focus — a crown earned inside
 * a node has to show the moment you come back. Shared by the Learn hub and the
 * path screen, which both state the same totals.
 */
export function useRtkPath(): RtkPath {
  const { dictDb } = useDatabase();
  const userDb = useUserDb();
  const [summary, setSummary] = useState<PathSummary | null>(null);

  const refresh = useCallback(
    async (stillMounted: () => boolean = () => true) => {
      if (!dictDb || !userDb) return;
      const [shapes, progress] = await Promise.all([
        unitShapes(dictDb),
        loadCourseProgress(userDb),
      ]);
      // Filter before the summary, so the tiles and Continue cannot disagree
      // about which units exist.
      const real = shapes.filter((shape) => shape.nodeCount > 0);
      if (stillMounted()) setSummary(pathSummary(real, crownsFromProgress(progress)));
    },
    [dictDb, userDb],
  );

  useFocusEffect(
    useCallback(() => {
      let current = true;
      refresh(() => current).catch((err) => console.warn("[learn] could not load the path", err));
      return () => {
        current = false;
      };
    }, [refresh]),
  );

  return { summary, unavailable: !dictDb || summary?.rows.length === 0 };
}
