const { APP_VERSION } = require("./lib/version.ts");

/**
 * This app's Sentry, under names nothing else on the machine uses.
 *
 * A native build's upload target is pinned when this config is evaluated, and
 * the plugin used to be a bare string - so it read the generic SENTRY_ORG /
 * SENTRY_PROJECT / SENTRY_AUTH_TOKEN, which on a laptop shared with another
 * product belong to that product. A local build would then push this app's
 * debug files into somebody else's organisation.
 *
 * No prefixed variables, no plugin: this app has no Sentry organisation of its
 * own yet, and the alternative to uploading nothing is uploading elsewhere.
 */
const SENTRY_ORG = process.env.JITEN_SENTRY_ORG;
const SENTRY_PROJECT = process.env.JITEN_SENTRY_PROJECT;
const SENTRY_PLUGIN =
  SENTRY_ORG && SENTRY_PROJECT
    ? [
        "@sentry/react-native/expo",
        {
          organization: SENTRY_ORG,
          project: SENTRY_PROJECT,
          url: process.env.SENTRY_URL || "https://sentry.io/",
        },
      ]
    : null;

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
      ...(SENTRY_PLUGIN ? [SENTRY_PLUGIN] : []),
      "expo-router",
      "expo-updates",
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
