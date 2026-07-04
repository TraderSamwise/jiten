import { useEffect } from "react";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { runAssociationBackfill } from "@/db/association-backfill";

/**
 * Headless: populates the personal primitive-association index once, when both the user
 * DB and the strokes tier are ready. Best-effort — a failure never blocks the app.
 */
export function AssociationBackfill() {
  const userDb = useUserDb();
  const { strokesDb } = useDatabase();

  useEffect(() => {
    if (!userDb || !strokesDb) return;
    let cancelled = false;
    runAssociationBackfill(userDb, strokesDb).catch((e) => {
      if (!cancelled) console.warn("[AssociationBackfill] failed:", String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [userDb, strokesDb]);

  return null;
}
