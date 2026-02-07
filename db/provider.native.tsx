import React, { createContext, useContext, useEffect, useState } from "react";
import * as SQLite from "expo-sqlite";

interface DatabaseContextType {
  dictDb: SQLite.SQLiteDatabase | null;
  isReady: boolean;
  isWeb: boolean;
}

const DatabaseContext = createContext<DatabaseContextType>({
  dictDb: null,
  isReady: false,
  isWeb: false,
});

export function useDatabase() {
  return useContext(DatabaseContext);
}

export function useDictDb() {
  const { dictDb } = useDatabase();
  if (!dictDb) throw new Error("Dictionary database not ready");
  return dictDb;
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DatabaseContextType>({
    dictDb: null,
    isReady: false,
    isWeb: false,
  });

  useEffect(() => {
    async function init() {
      const dictDb = await SQLite.openDatabaseAsync("dictionary.db", {
        assetSource: { assetId: require("../assets/dictionary.db") },
      });

      setState({ dictDb, isReady: true, isWeb: false });
    }

    init().catch((err) => {
      console.error("[DB] Init error:", err);
      setState({ dictDb: null, isReady: true, isWeb: false });
    });
  }, []);

  return (
    <DatabaseContext.Provider value={state}>{children}</DatabaseContext.Provider>
  );
}
