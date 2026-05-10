declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_DICT_MANIFEST_URL?: string;
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
    EXPO_PUBLIC_API_BASE_URL?: string;
    EXPO_PUBLIC_DEV_SYNC?: string;
    EXPO_PUBLIC_TURSO_ORG?: string;
    EXPO_PUBLIC_SENTRY_DSN?: string;
  }
}
