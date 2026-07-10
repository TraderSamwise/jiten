// Deterministic short DB name from a Clerk user id — MUST match the client's
// hashUserId so a user resolves to the same Turso child database everywhere.
export function hashUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
