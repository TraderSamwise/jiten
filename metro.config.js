const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// expo-sqlite web support requires wa-sqlite WASM to be served as an asset
config.resolver.assetExts.push("wasm");

module.exports = withNativeWind(config, { input: "./global.css" });
