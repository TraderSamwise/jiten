import React, { createContext, useContext, useEffect, useState } from "react";
import { open } from "@op-engineering/op-sqlite";
import type { DB } from "@op-engineering/op-sqlite";
import { wrapUserDb, type WrappedUserDb } from "./user-db";
import { USER_DB_MIGRATIONS } from "./user-migrations";
import { makeDefaultListId } from "@/lib/seed-default-lists";

interface UserDbContextType {
  userDb: WrappedUserDb | null;
  isReady: boolean;
}

const UserDbContext = createContext<UserDbContextType>({
  userDb: null,
  isReady: false,
});

export function useUserDb(): WrappedUserDb | null {
  const { userDb } = useContext(UserDbContext);
  return userDb;
}

export function UserDatabaseProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<UserDbContextType>({
    userDb: null,
    isReady: false,
  });

  useEffect(() => {
    let db: DB | null = null;

    async function init() {
      console.log("[UserDB Native] Opening user.db...");
      db = open({ name: "user.db" });

      // Run only pending migrations (tracked via PRAGMA user_version)
      const vr = await db.execute("PRAGMA user_version");
      const currentVersion = (vr.rows?.[0] as any)?.user_version ?? 0;
      const pending = USER_DB_MIGRATIONS.slice(currentVersion);
      console.log(
        `[UserDB Native] Version ${currentVersion}, ${pending.length} pending migrations`,
      );
      for (const sql of pending) {
        try {
          await db.execute(sql);
        } catch (err) {
          if (!String(err).includes("duplicate column")) throw err;
        }
      }
      if (pending.length > 0) {
        await db.execute(`PRAGMA user_version = ${USER_DB_MIGRATIONS.length}`);
        console.log(`[UserDB Native] Migrated to version ${USER_DB_MIGRATIONS.length}`);
      }

      // Programmatic migration: rename random default IDs → deterministic slugs
      const wrapped = wrapUserDb(db);
      const migrated = await wrapped.getFirstAsync<{ value: string }>(
        "SELECT value FROM app_flags WHERE key = 'default_ids_migrated'",
      );
      if (!migrated) {
        // Disable FKs during migration — UPDATE on PK internally does DELETE+INSERT
        // which triggers CASCADE and destroys the FK references we just updated.
        await db.execute("PRAGMA foreign_keys = OFF");
        const defaults = await wrapped.getAllAsync<{ id: string; name: string }>(
          "SELECT id, name FROM lists WHERE is_default = 1",
        );
        for (const list of defaults) {
          const newId = makeDefaultListId(list.name);
          if (list.id === newId) continue;
          await wrapped.runAsync("UPDATE list_entries SET list_id = ? WHERE list_id = ?", [
            newId,
            list.id,
          ]);
          await wrapped.runAsync("UPDATE srs_cards SET list_id = ? WHERE list_id = ?", [
            newId,
            list.id,
          ]);
          await wrapped.runAsync("UPDATE lists SET id = ? WHERE id = ?", [newId, list.id]);
        }
        // Also migrate default books
        const defaultBooks = await wrapped.getAllAsync<{ id: string; title: string }>(
          "SELECT id, title FROM books WHERE is_default = 1",
        );
        for (const book of defaultBooks) {
          const newId = makeDefaultListId("yume-juuya");
          if (book.id === newId) continue;
          await wrapped.runAsync("UPDATE books SET id = ? WHERE id = ?", [newId, book.id]);
        }
        await wrapped.runAsync(
          "INSERT OR REPLACE INTO app_flags (key, value) VALUES ('default_ids_migrated', '1')",
        );
        await db.execute("PRAGMA foreign_keys = ON");
      }

      // Cleanup old temporary marked-for-review lists (>24h old) and old review marks (>90 days)
      wrapped
        .runAsync(
          `DELETE FROM lists WHERE id LIKE '_marked_%' AND created_at < datetime('now', '-1 day')`,
        )
        .catch(() => {});
      wrapped
        .runAsync(`DELETE FROM review_marks WHERE marked_at < datetime('now', '-90 days')`)
        .catch(() => {});

      console.log("[UserDB Native] Initialized successfully");
      setState({ userDb: wrapped, isReady: true });
    }

    init().catch((err) => {
      console.error("[UserDB Native] Init error:", err);
      setState({ userDb: null, isReady: true });
    });

    return () => {
      if (db) {
        try {
          db.close();
        } catch {}
      }
    };
  }, [userId]);

  return <UserDbContext.Provider value={state}>{children}</UserDbContext.Provider>;
}
