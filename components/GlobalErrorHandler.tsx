import { useEffect, useState } from "react";
import { ErrorScreen, checkForUpdates } from "@/components/ErrorScreen";

interface CaughtError {
  message: string;
  stack?: string;
  source: string;
}

let globalErrorSetter: ((error: CaughtError) => void) | null = null;

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
