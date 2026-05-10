/**
 * Validated environment variables.
 * Uses lazy getters so errors are thrown during rendering
 * (catchable by error boundaries) rather than at module evaluation time.
 */

import { DEFAULT_DICT_MANIFEST_URL, rawEnv } from "./envRuntime";

export const env = {
  get DICT_MANIFEST_URL(): string {
    return rawEnv.EXPO_PUBLIC_DICT_MANIFEST_URL || DEFAULT_DICT_MANIFEST_URL;
  },
  get CLERK_PUBLISHABLE_KEY(): string | undefined {
    return rawEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || undefined;
  },
  get API_BASE_URL(): string | undefined {
    return rawEnv.EXPO_PUBLIC_API_BASE_URL || undefined;
  },
  get DEV_SYNC(): boolean {
    return rawEnv.EXPO_PUBLIC_DEV_SYNC === "1";
  },
  get TURSO_ORG(): string | undefined {
    return rawEnv.EXPO_PUBLIC_TURSO_ORG || undefined;
  },
  get SENTRY_DSN(): string | undefined {
    return rawEnv.EXPO_PUBLIC_SENTRY_DSN || undefined;
  },
};
