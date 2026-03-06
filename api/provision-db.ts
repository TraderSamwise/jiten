/**
 * Vercel serverless function — Clerk webhook handler for user.created events.
 * Provisions a Turso child database for each new user.
 *
 * Required env vars (set in Vercel dashboard):
 *   TURSO_API_TOKEN        — from `turso auth api-tokens mint`
 *   TURSO_ORG              — your Turso organization name
 *   TURSO_GROUP            — your Turso database group name
 *   CLERK_WEBHOOK_SECRET   — from Clerk dashboard webhook signing secret
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Webhook } from "svix";

function hashUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify webhook signature
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[provision] Missing CLERK_WEBHOOK_SECRET");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const svixId = req.headers["svix-id"] as string;
  const svixTimestamp = req.headers["svix-timestamp"] as string;
  const svixSignature = req.headers["svix-signature"] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(401).json({ error: "Missing webhook signature headers" });
  }

  let event: any;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(JSON.stringify(req.body), {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (err) {
    console.error("[provision] Webhook verification failed:", err);
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  if (event?.type !== "user.created") {
    return res.status(200).json({ ok: true, ignored: true });
  }

  const userId = event.data?.id;
  if (!userId) {
    return res.status(400).json({ error: "Missing user ID" });
  }

  const dbName = hashUserId(userId);
  const org = process.env.TURSO_ORG;
  const group = process.env.TURSO_GROUP;
  const apiToken = process.env.TURSO_API_TOKEN;

  if (!org || !group || !apiToken) {
    console.error("[provision] Missing env vars");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  try {
    const response = await fetch(`https://api.turso.tech/v1/organizations/${org}/databases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: dbName, group }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 409) {
        console.log(`[provision] DB ${dbName} already exists for ${userId}`);
        return res.status(200).json({ ok: true, dbName, existing: true });
      }
      throw new Error(`Turso API error ${response.status}: ${body}`);
    }

    console.log(`[provision] Created DB ${dbName} for user ${userId}`);
    return res.status(200).json({ ok: true, dbName });
  } catch (err: any) {
    console.error("[provision] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
