import { verifyToken } from "@clerk/backend";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface VerifiedApiUser {
  userId: string;
}

// Verify a bare Clerk session token (no transport assumptions) — the req/res-free
// core shared by the Vercel handlers and the Hono auth middleware.
export async function verifyClerkToken(token: string): Promise<VerifiedApiUser> {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    console.error("[api-auth] Missing CLERK_SECRET_KEY");
    throw new ApiError(500, "Server misconfigured");
  }

  try {
    const payload = await verifyToken(token, { secretKey: clerkSecretKey });
    return { userId: payload.sub };
  } catch (err) {
    console.error("[api-auth] Token verification failed:", err);
    throw new ApiError(401, "Invalid session token");
  }
}
