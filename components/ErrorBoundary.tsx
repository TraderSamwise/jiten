import { ErrorScreen, checkForUpdates } from "@/components/ErrorScreen";
import { captureException } from "@/lib/sentry";

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  captureException(error, { tags: { type: "react_error_boundary" } });

  return (
    <ErrorScreen
      source="Error"
      message={error.message}
      stack={error.stack}
      primaryAction={{ label: "Try Again", onPress: retry }}
      secondaryAction={{
        label: "Check for Updates",
        onPress: () => checkForUpdates(retry),
      }}
    />
  );
}
