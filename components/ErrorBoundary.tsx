import { ErrorScreen, checkForUpdates } from "@/components/ErrorScreen";

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
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
