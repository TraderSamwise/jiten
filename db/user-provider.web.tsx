import React, { createContext, useContext } from "react";

interface UserDbContextType {
  userDb: null;
  isReady: boolean;
}

const UserDbContext = createContext<UserDbContextType>({
  userDb: null,
  isReady: true,
});

export function useUserDb(): never {
  throw new Error("User database not available on web");
}

export function UserDatabaseProvider({
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  return (
    <UserDbContext.Provider value={{ userDb: null, isReady: true }}>
      {children}
    </UserDbContext.Provider>
  );
}
