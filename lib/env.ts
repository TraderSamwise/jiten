/**
 * Validated environment variables.
 * Throws at startup if required vars are missing.
 */

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string): string | undefined {
  return process.env[key] || undefined;
}

export const env = {
  DICT_MANIFEST_URL: required("EXPO_PUBLIC_DICT_MANIFEST_URL"),
  CLERK_PUBLISHABLE_KEY: optional("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"),
};
