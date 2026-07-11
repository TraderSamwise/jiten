import { Hono } from "hono";
import { cors } from "hono/cors";

import { apiErrorResponse } from "./middleware/error";
import { provisionDbRoute } from "./routes/provisionDb";
import { proxyRoute } from "./routes/proxy";
import { readerExplainRoute } from "./routes/readerExplain";
import { tursoTokenRoute } from "./routes/tursoToken";
import { wordsExampleRoute } from "./routes/wordsExample";
import type { AppVariables } from "./types";

// The single Hono app: mounted as the Vercel catch-all in prod (api/[...route].ts)
// and served directly by the local dev server (server/dev.ts). Sub-routers are
// chained with .route() so their types accumulate onto AppType (for the RPC client).
const base = new Hono<{ Variables: AppVariables }>();

base.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

base.get("/api/health", (c) => c.json({ ok: true }));

base.notFound((c) => c.json({ error: "Not found" }, 404));
base.onError((err, c) => apiErrorResponse(err, c));

export const app = base
  .route("/", readerExplainRoute)
  .route("/", wordsExampleRoute)
  .route("/", tursoTokenRoute)
  .route("/", provisionDbRoute)
  .route("/", proxyRoute);

export type AppType = typeof app;
