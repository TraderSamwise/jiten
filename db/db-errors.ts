export function isClosedUserDbConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("Null connection");
}
