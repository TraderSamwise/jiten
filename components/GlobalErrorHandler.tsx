import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { ErrorScreen, checkForUpdates } from "@/components/ErrorScreen";
import { WebDbRecoveryScreen } from "@/components/WebDbRecoveryScreen";

interface CaughtError {
  message: string;
  stack?: string;
  source: string;
}

function isDbError(error: CaughtError): boolean {
  // Errors explicitly reported by our DB wrapper
  if (error.source === "Database Error") return true;
  // Errors from expo-sqlite web worker — all flow through workerMessageHandler
  const text = `${error.message} ${error.stack ?? ""}`;
  return (
    text.includes("workerMessageHandler") ||
    text.includes("WorkerChannel") ||
    text.includes("expo-sqlite")
  );
}

let globalErrorSetter: ((error: CaughtError) => void) | null = null;

/** Call this from DB wrappers to surface query errors as recoverable DB errors */
export function notifyDbError(err: unknown, sql?: string) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  globalErrorSetter?.({
    message: sql ? `${message}\n\nQuery: ${sql}` : message,
    stack,
    source: "Database Error",
  });
}

function setupGlobalHandlers() {
  // Catch uncaught JS exceptions
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    globalErrorSetter?.({
      message: `${isFatal ? "[Fatal] " : ""}${error.message}`,
      stack: error.stack,
      source: "Uncaught Exception",
    });
    // Log but don't call original handler — it terminates the app on fatal errors
    console.error("[GlobalErrorHandler]", error);
  });

  // Catch unhandled promise rejections
  const originalRejection = (global as any).onunhandledrejection;
  (global as any).onunhandledrejection = (event: any) => {
    const reason = event?.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : JSON.stringify(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    globalErrorSetter?.({
      message,
      stack,
      source: "Unhandled Promise Rejection",
    });
    originalRejection?.(event);
  };
}

export function GlobalErrorHandler({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<CaughtError | null>(null);

  useEffect(() => {
    globalErrorSetter = setError;
    setupGlobalHandlers();
    return () => {
      globalErrorSetter = null;
    };
  }, []);

  if (error) {
    const dismiss = () => setError(null);

    if (Platform.OS === "web" && isDbError(error)) {
      return <WebDbRecoveryScreen error={error} onDismiss={dismiss} />;
    }

    return (
      <ErrorScreen
        source={error.source}
        message={error.message}
        stack={error.stack}
        primaryAction={{ label: "Dismiss", onPress: dismiss }}
        secondaryAction={{
          label: "Check for Updates",
          onPress: () => checkForUpdates(dismiss),
        }}
      />
    );
  }

  return <>{children}</>;
}
