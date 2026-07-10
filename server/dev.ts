import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { app } from "./app";

// Local dev server (yarn serve:dev): one origin on :3001 that mirrors prod — it
// serves the API (/api/*) and the reverse proxy (/proxy/*) through the SAME Hono
// app used in production, plus the dictionary .db files + manifest from assets/
// (which prod fetches from the GitHub release instead). Replaces the old
// scripts/serve-dev.ts.
const PORT = 3001;

const dev = new Hono();

dev.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

// Static dict files first: serveStatic calls next() on a miss, so /api and
// /proxy fall through to the app. GET-only, so POST routes are never intercepted.
dev.get("/*", serveStatic({ root: "./assets" }));
dev.route("/", app);

serve({ fetch: dev.fetch, port: PORT }, (info) => {
  console.log(`jiten dev server (API + data) on http://localhost:${info.port}`);
});
