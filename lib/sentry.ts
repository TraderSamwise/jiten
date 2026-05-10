import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";

import { env } from "./env";

/** Initialize Sentry. Safe to call even if DSN is not configured. */
export function initSentry() {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    // Send 100% of errors (free tier is 5k/month — more than enough)
    sampleRate: 1.0,
    // No performance tracing — keep it lightweight
    tracesSampleRate: 0,
    // Offline: @sentry/react-native buffers events automatically on native.
    // On web, events that fail to send are dropped (acceptable for free tier).
    enableAutoSessionTracking: true,
    environment: __DEV__ ? "development" : "production",
    // Don't send in dev by default
    enabled: !__DEV__,
  });

  Sentry.setTag("platform", Platform.OS);
}

/** Capture an exception with optional context. */
export function captureException(
  err: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
) {
  if (!env.SENTRY_DSN) return;
  Sentry.captureException(err, {
    tags: context?.tags,
    extra: context?.extra,
  });
}

/** Capture a message (non-error event). */
export function captureMessage(message: string, level: Sentry.SeverityLevel = "info") {
  if (!env.SENTRY_DSN) return;
  Sentry.captureMessage(message, level);
}

/** Set the current user for error context. */
export function setSentryUser(userId: string | null) {
  if (!env.SENTRY_DSN) return;
  if (userId && userId !== "local") {
    Sentry.setUser({ id: userId });
  } else {
    Sentry.setUser(null);
  }
}
