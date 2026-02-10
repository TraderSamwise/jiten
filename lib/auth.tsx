import React, { createContext, useContext } from "react";
import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";

export const AUTH_BYPASS = process.env.EXPO_PUBLIC_AUTH_BYPASS === "true";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!AUTH_BYPASS && !publishableKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY — add it to your .env file or set EXPO_PUBLIC_AUTH_BYPASS=true",
  );
}

// Bypass context for dev mode without Clerk
const BypassAuthContext = createContext({
  isSignedIn: true,
  isLoaded: true,
  userId: "dev-user",
});

function useBypassAuth() {
  return useContext(BypassAuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (AUTH_BYPASS) {
    return (
      <BypassAuthContext.Provider value={{ isSignedIn: true, isLoaded: true, userId: "dev-user" }}>
        {children}
      </BypassAuthContext.Provider>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache}>
      {children}
    </ClerkProvider>
  );
}

/* eslint-disable react-hooks/rules-of-hooks -- AUTH_BYPASS is a build-time constant */
export function useAuth() {
  if (AUTH_BYPASS) {
    return useBypassAuth();
  }
  return useClerkAuth();
}
/* eslint-enable react-hooks/rules-of-hooks */
