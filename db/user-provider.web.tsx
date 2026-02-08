import React, { createContext, useContext } from "react";

interface UserDbContextType {
  userDb: null;
  isReady: boolean;
}

const UserDbContext = createContext<UserDbContextType>({
  userDb: null,
  isReady: true,
});

export function useUserDb(): null {
  return null;
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
