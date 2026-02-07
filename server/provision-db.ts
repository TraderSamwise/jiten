/**
 * Clerk webhook handler for user.created events.
 * Provisions a Turso child database for each new user.
 *
 * Deploy as a Vercel serverless function or Cloudflare Worker.
 *
 * Required env vars:
 *   CLERK_WEBHOOK_SECRET  — from Clerk dashboard
 *   TURSO_API_TOKEN       — from `turso auth api-tokens mint`
 *   TURSO_ORG             — your Turso organization name
 *   TURSO_GROUP           — your Turso database group name
 *
 * Setup:
 *   1. Create a parent schema DB in your Turso group:
 *      turso db create user-schema --group <group>
 *      turso db shell user-schema < schema.sql
 *   2. Point the Clerk webhook to this endpoint with event "user.created"
 */

import type { IncomingMessage, ServerResponse } from "http";

// -- Hash function matching the client-side hashUserId --
function hashUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

interface ClerkWebhookEvent {
  type: string;
  data: {
    id: string;
    [key: string]: any;
  };
}

export default async function handler(
  req: IncomingMessage & { body?: any },
  res: ServerResponse
) {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  // In production, verify the Clerk webhook signature using svix.
  // See: https://clerk.com/docs/webhooks/sync-data#validate-the-webhook-signature

  const event: ClerkWebhookEvent = req.body;

  if (event.type !== "user.created") {
    res.writeHead(200);
    res.end("ignored");
    return;
  }

  const userId = event.data.id;
  const dbName = hashUserId(userId);
  const org = process.env.TURSO_ORG!;
  const group = process.env.TURSO_GROUP!;
  const apiToken = process.env.TURSO_API_TOKEN!;

  try {
    // Create child database in the Turso group
    // It inherits the schema from the parent database
    const response = await fetch(
      `https://api.turso.tech/v1/organizations/${org}/databases`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: dbName,
          group,
          schema: "user-schema",
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      // 409 = DB already exists, which is fine (idempotent)
      if (response.status === 409) {
        console.log(`[provision] DB ${dbName} already exists for ${userId}`);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, dbName, existing: true }));
        return;
      }
      throw new Error(`Turso API error ${response.status}: ${body}`);
    }

    console.log(`[provision] Created DB ${dbName} for user ${userId}`);
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, dbName }));
  } catch (err: any) {
    console.error("[provision] Error:", err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}
