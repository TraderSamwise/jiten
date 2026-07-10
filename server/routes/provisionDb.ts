import { Hono } from "hono";
import { Webhook } from "svix";

import { ApiError } from "../../api/_shared/auth";
import { hashUserId } from "../lib/hashUserId";
import type { AppVariables } from "../types";

// Clerk webhook (user.created) → provision a Turso child DB for the new user.
// The signature is verified against the RAW request body (svix requires the exact
// payload bytes), so this route is unauthenticated by bearer token by design.
export const provisionDbRoute = new Hono<{ Variables: AppVariables }>().post(
  "/api/provision-db",
  async (c) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[provision] Missing CLERK_WEBHOOK_SECRET");
      throw new ApiError(500, "Server misconfigured");
    }

    const svixId = c.req.header("svix-id");
    const svixTimestamp = c.req.header("svix-timestamp");
    const svixSignature = c.req.header("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new ApiError(401, "Missing webhook signature headers");
    }

    const payload = await c.req.text();
    let event: unknown;
    try {
      event = new Webhook(secret).verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch (err) {
      console.error("[provision] Webhook verification failed:", err);
      throw new ApiError(401, "Invalid webhook signature");
    }

    const evt = event as { type?: string; data?: { id?: string } };
    if (evt?.type !== "user.created") {
      return c.json({ ok: true, ignored: true });
    }
    const userId = evt.data?.id;
    if (!userId) {
      throw new ApiError(400, "Missing user ID");
    }

    const org = process.env.TURSO_ORG;
    const group = process.env.TURSO_GROUP;
    const apiToken = process.env.TURSO_API_TOKEN;
    if (!org || !group || !apiToken) {
      console.error("[provision] Missing env vars");
      throw new ApiError(500, "Server misconfigured");
    }

    const dbName = hashUserId(userId);
    const response = await fetch(`https://api.turso.tech/v1/organizations/${org}/databases`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: dbName, group }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 409) {
        console.log(`[provision] DB ${dbName} already exists for ${userId}`);
        return c.json({ ok: true, dbName, existing: true });
      }
      console.error(`[provision] Turso API error ${response.status}: ${body}`);
      throw new ApiError(500, `Turso API error ${response.status}`);
    }

    console.log(`[provision] Created DB ${dbName} for user ${userId}`);
    return c.json({ ok: true, dbName });
  },
);
