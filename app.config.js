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
    ios: {
      supportsTablet: true,
      bundleIdentifier: "tokyo.jiten.mobile",
      buildNumber: String(APP_VERSION.buildNumber),
      infoPlist: {
        AppGroup: "group.tokyo.jiten.mobile",
        AppGroupIdentifier: "group.tokyo.jiten.mobile",
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
      package: "tokyo.jiten.mobile",
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#4c3aa8",
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
    runtimeVersion: `${APP_VERSION.version}-${APP_VERSION.buildNumber}`,
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
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#f4efe4",
          dark: {
            image: "./assets/images/splash-icon-dark.png",
            backgroundColor: "#14110c",
          },
        },
      ],
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
