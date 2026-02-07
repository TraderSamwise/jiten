const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Allow bundling .db files as assets
config.resolver.assetExts.push("db");

module.exports = withNativeWind(config, { input: "./global.css" });
