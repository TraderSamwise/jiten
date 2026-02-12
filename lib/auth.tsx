import React, { createContext, useContext } from "react";
import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";

import { env } from "@/lib/env";

/** true when no Clerk key is configured — app runs fully local */
const LOCAL_MODE = !env.CLERK_PUBLISHABLE_KEY;

// Local-mode context: always signed in as "local" user
const LocalAuthContext = createContext({
  isSignedIn: true,
  isLoaded: true,
  userId: "local",
});

function useLocalAuth() {
  return useContext(LocalAuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (LOCAL_MODE) {
    return (
      <LocalAuthContext.Provider value={{ isSignedIn: true, isLoaded: true, userId: "local" }}>
        {children}
      </LocalAuthContext.Provider>
    );
  }

  return (
    <ClerkProvider publishableKey={env.CLERK_PUBLISHABLE_KEY!} tokenCache={tokenCache}>
      {children}
    </ClerkProvider>
  );
}

/* eslint-disable react-hooks/rules-of-hooks -- LOCAL_MODE is a build-time constant */
export function useAuth() {
  if (LOCAL_MODE) {
    return useLocalAuth();
  }
  return useClerkAuth();
}
/* eslint-enable react-hooks/rules-of-hooks */
