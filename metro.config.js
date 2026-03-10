const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { withShareExtension } = require("expo-share-extension/metro");

const config = getDefaultConfig(__dirname);

// expo-sqlite web support requires wa-sqlite WASM to be served as an asset
config.resolver.assetExts.push("wasm");

// Jotai's ESM files use import.meta.env which breaks Metro's non-module web bundle.
// Force jotai to resolve to CJS files on web by rewriting .mjs → .js paths.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = originalResolveRequest || context.resolveRequest;
  const result = resolve(context, moduleName, platform);
  if (
    platform === "web" &&
    result?.type === "sourceFile" &&
    result.filePath.includes("/jotai/") &&
    result.filePath.endsWith(".mjs")
  ) {
    const cjsPath = result.filePath.replace(/\/esm\/(.+)\.mjs$/, "/$1.js");
    try {
      require("fs").accessSync(cjsPath);
      return { ...result, filePath: cjsPath };
    } catch {}
  }
  return result;
};

const finalConfig = withShareExtension(
  withNativeWind(config, { input: "./global.css" }),
);

// expo-share-extension's rewrite only handles "index.bundle" → "index.share.bundle",
// but Expo SDK 51+ uses ".expo/.virtual-metro-entry" as the entry point.
// We must rewrite BEFORE the parent resolvers so the virtual entry is never seen.
const parentRewrite = finalConfig.server.rewriteRequestUrl;
finalConfig.server.rewriteRequestUrl = (url) => {
  if (url.includes("shareExtension=true")) {
    const rewritten = url.replace(
      /\.expo\/\.virtual-metro-entry/,
      "index.share",
    );
    return parentRewrite(rewritten);
  }
  return parentRewrite(url);
};

module.exports = finalConfig;
