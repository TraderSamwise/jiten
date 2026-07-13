export function isClosedUserDbConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("Null connection");
}

// How a failed web DB open should be treated. "lock" = another tab holds the
// OPFS sync-access handle (recognised release messages). "io" = a raw
// SQLITE_IOERR (code 10) which on web is almost always that same contention
// surfacing after the release handshake timed out while the holder was busy.
// Both are transient and retry-worthy — neither should jump straight to the
// destructive recovery screen. "fatal" = anything else.
export type OpenFailure = "lock" | "io" | "fatal";

export function classifyOpenError(err: unknown): OpenFailure {
  const msg = String(err);
  if (
    msg.includes("createSyncAccessHandle") ||
    msg.includes("NoModificationAllowedError") ||
    msg.includes("Access Handles cannot be created") ||
    msg.includes("Invalid VFS state")
  ) {
    return "lock";
  }
  // Match code 10 as a whole token so "code 100"/"code 101" (unrelated) don't
  // get mistaken for the code-10 disk-I/O error.
  if (msg.includes("disk I/O error") || /\bcode\s+10\b/.test(msg)) return "io";
  return "fatal";
}
