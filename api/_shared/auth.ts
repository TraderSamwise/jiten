import type { VercelRequest } from "@vercel/node";
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

export async function verifyApiUser(req: VercelRequest): Promise<VerifiedApiUser> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing authorization header");
  }

  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    console.error("[api-auth] Missing CLERK_SECRET_KEY");
    throw new ApiError(500, "Server misconfigured");
  }

  try {
    const payload = await verifyToken(authHeader.slice(7), { secretKey: clerkSecretKey });
    return { userId: payload.sub };
  } catch (err) {
    console.error("[api-auth] Token verification failed:", err);
    throw new ApiError(401, "Invalid session token");
  }
}
