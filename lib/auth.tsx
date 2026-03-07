import React, { createContext, useContext } from "react";
import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";

import { env } from "@/lib/env";

export interface AuthState {
  isSignedIn: boolean;
  isLoaded: boolean;
  userId: string | null;
  signOut: () => Promise<void>;
}

/** true when no Clerk key is configured — app runs fully local */
const LOCAL_MODE = !env.CLERK_PUBLISHABLE_KEY;

const noop = async () => {};

// Local-mode context: always signed in as "local" user
const LocalAuthContext = createContext<AuthState>({
  isSignedIn: true,
  isLoaded: true,
  userId: "local",
  signOut: noop,
});

function useLocalAuth(): AuthState {
  return useContext(LocalAuthContext);
}

function useClerkAuthAdapter(): AuthState {
  const { isSignedIn, isLoaded, userId, signOut } = useClerkAuth();
  return {
    isSignedIn: isSignedIn ?? false,
    isLoaded: isLoaded ?? false,
    userId: userId ?? null,
    signOut: async () => {
      await signOut();
    },
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (LOCAL_MODE) {
    return (
      <LocalAuthContext.Provider
        value={{ isSignedIn: true, isLoaded: true, userId: "local", signOut: noop }}
      >
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
export function useAuth(): AuthState {
  if (LOCAL_MODE) {
    return useLocalAuth();
  }
  return useClerkAuthAdapter();
}
/* eslint-enable react-hooks/rules-of-hooks */
