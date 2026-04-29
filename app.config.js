const { APP_VERSION } = require("./lib/version.ts");

module.exports = {
  expo: {
    name: "jiten",
    slug: "jiten",
    version: APP_VERSION.version || "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "jiten",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.tradersamwise.jiten",
      buildNumber: String(APP_VERSION.buildNumber),
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription:
          "Allow $(PRODUCT_NAME) to access your photo library for saving and sharing content.",
        LSApplicationQueriesSchemes: [
          "midori",
          "shirabelookup",
          "dakanji",
          "imiwa",
          "googletranslate",
          "claude",
          "chatgpt",
        ],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      versionCode: APP_VERSION.buildNumber,
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
    },
    web: {
      bundler: "metro",
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    runtimeVersion: "1.0.0",
    updates: {
      url: "https://u.expo.dev/cfa88854-7b95-457e-a330-fd7a1ea55da1",
      enabled: true,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 30000,
    },
    plugins: [
      "expo-router",
      "expo-updates",
      "@sentry/react-native/expo",
      [
        "@jamsch/expo-speech-recognition",
        {
          microphonePermission:
            "Allow $(PRODUCT_NAME) to use the microphone for voice-controlled flashcards.",
          speechRecognitionPermission:
            "Allow $(PRODUCT_NAME) to use speech recognition for voice-controlled flashcards.",
        },
      ],
      [
        "expo-share-extension",
        {
          preprocessingFile: "./lib/share-extension/preprocessing.js",
          excludedPackages: [
            "expo-dev-client",
            "expo-splash-screen",
            "expo-updates",
            "@jamsch/expo-speech-recognition",
          ],
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "cfa88854-7b95-457e-a330-fd7a1ea55da1",
      },
    },
    owner: "tradersamwise",
  },
};
