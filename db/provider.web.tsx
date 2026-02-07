import React, { createContext, useContext, useState, useEffect } from "react";

interface DatabaseContextType {
  dictDb: null;
  isReady: boolean;
  isWeb: boolean;
}

const DatabaseContext = createContext<DatabaseContextType>({
  dictDb: null,
  isReady: false,
  isWeb: true,
});

export function useDatabase() {
  return useContext(DatabaseContext);
}

export function useDictDb(): never {
  throw new Error("Dictionary database not available on web");
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    console.log("[DB] Web mode — SQLite not available, using placeholder UI");
    setIsReady(true);
  }, []);

  return (
    <DatabaseContext.Provider
      value={{ dictDb: null, isReady, isWeb: true }}
    >
      {children}
    </DatabaseContext.Provider>
  );
}
