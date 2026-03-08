export function formatInterval(dueDate: Date, now: Date = new Date()): string {
  const diffMs = dueDate.getTime() - now.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = Math.round(days / 30);
  return `${months}mo`;
}
