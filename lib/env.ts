/**
 * Validated environment variables.
 * Uses lazy getters so errors are thrown during rendering
 * (catchable by error boundaries) rather than at module evaluation time.
 */

export const env = {
  get DICT_MANIFEST_URL(): string {
    return (
      process.env.EXPO_PUBLIC_DICT_MANIFEST_URL ||
      "https://github.com/TraderSamwise/jiten-data/releases/download/v1/dict-manifest.json"
    );
  },
  get CLERK_PUBLISHABLE_KEY(): string | undefined {
    return process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || undefined;
  },
  get API_BASE_URL(): string | undefined {
    return process.env.EXPO_PUBLIC_API_BASE_URL || undefined;
  },
  get TURSO_ORG(): string | undefined {
    return process.env.EXPO_PUBLIC_TURSO_ORG || undefined;
  },
};
