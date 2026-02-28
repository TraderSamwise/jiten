/**
 * Check if an Expo native module is available in the current binary.
 * Uses `requireOptionalNativeModule` which returns null instead of throwing
 * when the module isn't linked. Safe to call at any time.
 */
export function isNativeModuleAvailable(moduleName: string): boolean {
  try {
    const { requireOptionalNativeModule } = require("expo-modules-core");
    return requireOptionalNativeModule(moduleName) != null;
  } catch {
    return false;
  }
}
