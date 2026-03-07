import { createClient, type Client } from "@libsql/client/web";
import { env } from "../lib/env";

/**
 * Hash a Clerk user ID to a short alphanumeric string for Turso DB names.
 * Duplicated from api/provision-db.ts intentionally — that file runs in
 * Vercel serverless (different build context).
 */
function hashUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function createTursoClient(userId: string): Client {
  const org = env.TURSO_ORG;
  const token = env.TURSO_AUTH_TOKEN;
  if (!org || !token) {
    throw new Error("Turso env vars not configured (TURSO_ORG, TURSO_AUTH_TOKEN)");
  }
  const dbName = hashUserId(userId);
  return createClient({
    url: `libsql://${dbName}-${org}.turso.io`,
    authToken: token,
  });
}

/** Returns true if all required env vars for cloud sync are set.
 *  Disabled in __DEV__ by default to avoid spamming Turso on hot reloads.
 *  Set EXPO_PUBLIC_DEV_SYNC=1 to enable sync during development. */
export function isSyncEnabled(): boolean {
  if (__DEV__ && !process.env.EXPO_PUBLIC_DEV_SYNC) return false;
  return !!(env.CLERK_PUBLISHABLE_KEY && env.TURSO_AUTH_TOKEN && env.TURSO_ORG);
}
