import React, { createContext, useContext, useEffect, useState } from "react";
import { open } from "@op-engineering/op-sqlite";
import type { DB } from "@op-engineering/op-sqlite";
import { wrapUserDb, type WrappedUserDb } from "./user-db";
import { USER_DB_MIGRATIONS } from "./user-migrations";

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
      db = open({ name: "user.db" });

      // Run only pending migrations (tracked via PRAGMA user_version)
      const vr = await db.execute("PRAGMA user_version");
      const currentVersion = (vr.rows?.[0] as any)?.user_version ?? 0;
      const pending = USER_DB_MIGRATIONS.slice(currentVersion);
      for (const sql of pending) {
        try {
          await db.execute(sql);
        } catch (err) {
          if (!String(err).includes("duplicate column")) throw err;
        }
      }
      if (pending.length > 0) {
        await db.execute(`PRAGMA user_version = ${USER_DB_MIGRATIONS.length}`);
      }

      const wrapped = wrapUserDb(db);
      setState({ userDb: wrapped, isReady: true });
    }

    init().catch((err) => {
      console.error("[UserDB] Init error:", err);
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
