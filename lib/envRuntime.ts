export const DEFAULT_DICT_MANIFEST_URL =
  "https://github.com/TraderSamwise/jiten-data/releases/download/v1/dict-manifest.json";

export const rawEnv = {
  get EXPO_PUBLIC_DICT_MANIFEST_URL(): string | undefined {
    return process.env.EXPO_PUBLIC_DICT_MANIFEST_URL;
  },
  get EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY(): string | undefined {
    return process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  },
  get EXPO_PUBLIC_API_BASE_URL(): string | undefined {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  },
  get EXPO_PUBLIC_DEV_SYNC(): string | undefined {
    return process.env.EXPO_PUBLIC_DEV_SYNC;
  },
  get EXPO_PUBLIC_TURSO_ORG(): string | undefined {
    return process.env.EXPO_PUBLIC_TURSO_ORG;
  },
  get EXPO_PUBLIC_SENTRY_DSN(): string | undefined {
    return process.env.EXPO_PUBLIC_SENTRY_DSN;
  },
};
