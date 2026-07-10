import { Hono } from "hono";
import { cors } from "hono/cors";

import { apiErrorResponse } from "./middleware/error";
import type { AppVariables } from "./types";

// The single Hono app: mounted as the Vercel catch-all in prod (api/[[...route]].ts)
// and served directly by the local dev server (server/dev.ts). Routes are added in
// Phase 2; this phase establishes the app, CORS, and error handling.
export const app = new Hono<{ Variables: AppVariables }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));

app.onError((err, c) => apiErrorResponse(err, c));

export type AppType = typeof app;
