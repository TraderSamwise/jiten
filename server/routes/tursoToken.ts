import { Hono } from "hono";

import { ApiError } from "../../api/_shared/auth";
import { authMiddleware } from "../middleware/auth";
import { hashUserId } from "../lib/hashUserId";
import type { AppVariables } from "../types";

// Mints a per-user scoped Turso auth token. The user's DB name is derived
// deterministically from the Clerk user id (hashUserId).
export const tursoTokenRoute = new Hono<{ Variables: AppVariables }>().post(
  "/api/turso-token",
  authMiddleware,
  async (c) => {
    const org = process.env.TURSO_ORG;
    const apiToken = process.env.TURSO_API_TOKEN;
    if (!org || !apiToken) {
      console.error("[turso-token] Missing env vars");
      throw new ApiError(500, "Server misconfigured");
    }

    const dbName = hashUserId(c.get("userId"));
    const response = await fetch(
      `https://api.turso.tech/v1/organizations/${org}/databases/${dbName}/auth/tokens?authorization=full-access`,
      { method: "POST", headers: { Authorization: `Bearer ${apiToken}` } },
    );

    if (!response.ok) {
      const body = await response.text();
      console.error("[turso-token] Turso API error", response.status, body.slice(0, 500));
      throw new ApiError(500, `Turso API error ${response.status}`);
    }

    const data = (await response.json()) as { jwt?: string };
    return c.json({ jwt: data.jwt });
  },
);
