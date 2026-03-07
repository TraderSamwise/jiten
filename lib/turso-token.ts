import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Get a scoped Turso auth token for the given user.
 * Returns a cached token from AsyncStorage if available,
 * otherwise fetches a new one from the server endpoint.
 */
export async function getTursoToken(
  userId: string,
  getClerkToken: () => Promise<string | null>,
  apiBaseUrl: string,
): Promise<string | null> {
  const cacheKey = `turso_token_${userId}`;

  // Check cache first
  const cached = await AsyncStorage.getItem(cacheKey);
  if (cached) return cached;

  // Get Clerk session token to authenticate with our API
  const clerkToken = await getClerkToken();
  if (!clerkToken) return null;

  try {
    const response = await fetch(`${apiBaseUrl}/api/turso-token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.jwt) return null;

    // Cache the token
    await AsyncStorage.setItem(cacheKey, data.jwt);
    return data.jwt;
  } catch {
    return null;
  }
}

/** Remove the cached Turso token for a user. */
export async function clearTursoToken(userId: string): Promise<void> {
  await AsyncStorage.removeItem(`turso_token_${userId}`);
}
