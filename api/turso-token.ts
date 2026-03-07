/**
 * Vercel serverless function — mints a per-user scoped Turso auth token.
 *
 * Required env vars (set in Vercel dashboard):
 *   TURSO_API_TOKEN        — from `turso auth api-tokens mint`
 *   TURSO_ORG              — your Turso organization name
 *   CLERK_SECRET_KEY       — from Clerk dashboard
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken } from "@clerk/backend";

function hashUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function setCors(res: VercelResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify Clerk session
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization header" });
  }

  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    console.error("[turso-token] Missing CLERK_SECRET_KEY");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  let userId: string;
  try {
    const sessionToken = authHeader.slice(7);
    const payload = await verifyToken(sessionToken, { secretKey: clerkSecretKey });
    userId = payload.sub;
  } catch (err) {
    console.error("[turso-token] Token verification failed:", err);
    return res.status(401).json({ error: "Invalid session token" });
  }

  const org = process.env.TURSO_ORG;
  const apiToken = process.env.TURSO_API_TOKEN;

  if (!org || !apiToken) {
    console.error("[turso-token] Missing env vars");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const dbName = hashUserId(userId);

  try {
    const response = await fetch(
      `https://api.turso.tech/v1/organizations/${org}/databases/${dbName}/auth/tokens?authorization=full-access`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Turso API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    return res.status(200).json({ jwt: data.jwt });
  } catch (err: any) {
    console.error("[turso-token] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
