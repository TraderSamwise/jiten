type ClerkError = {
  longMessage?: string;
  long_message?: string;
  message?: string;
};

export function clerkErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "errors" in err) {
    const first = (err as { errors?: ClerkError[] }).errors?.[0];
    return first?.longMessage ?? first?.long_message ?? first?.message ?? fallback;
  }
  return fallback;
}
