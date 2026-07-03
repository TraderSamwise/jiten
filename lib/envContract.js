const defaultedRuntimeEnvKeys = ["EXPO_PUBLIC_DICT_MANIFEST_URL"];

const optionalRuntimeEnvKeys = [
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_DEV_SYNC",
  "EXPO_PUBLIC_SENTRY_DSN",
  "EXPO_PUBLIC_TURSO_ORG",
];

const requiredReleaseEnvKeys = ["EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"];
const buildOnlyEnvKeys = ["SENTRY_DISABLE_AUTO_UPLOAD"];

const allKnownEnvKeys = Array.from(
  new Set([...defaultedRuntimeEnvKeys, ...optionalRuntimeEnvKeys, ...requiredReleaseEnvKeys]),
).sort();

module.exports = {
  defaultedRuntimeEnvKeys,
  optionalRuntimeEnvKeys,
  requiredReleaseEnvKeys,
  buildOnlyEnvKeys,
  allKnownEnvKeys,
};
