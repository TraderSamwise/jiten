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

// Surface missing API secrets up front — those routes 500 without them, and it's
// easy to lose an afternoon to a per-request "Server misconfigured". serve:dev
// loads .env via node's --env-file; add the missing keys there (see README).
const NEEDED_SECRETS = ["CLERK_SECRET_KEY", "OPENAI_API_KEY", "TURSO_ORG", "TURSO_API_TOKEN"];
const missing = NEEDED_SECRETS.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(
    `⚠️  Missing API env vars — routes using them will return 500: ${missing.join(", ")}.\n` +
      `   Add them to .env (see README → "Dev Server"). Static/proxy still work without them.`,
  );
}

// Bind to loopback by default — this server loads real API secrets, so it must
// not be exposed to the LAN. Set DEV_HOST=0.0.0.0 to opt into LAN access (e.g.
// to reach it from a device on the same network).
const HOST = process.env.DEV_HOST ?? "127.0.0.1";
serve({ fetch: dev.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`jiten dev server (API + data) on http://${HOST}:${info.port}`);
});
