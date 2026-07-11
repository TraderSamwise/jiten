import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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

// Routes that need secrets we deliberately don't keep locally get forwarded to
// the deployed API instead. Turso sync data never flows through here — the
// libsql client talks to Turso directly; this only proxies the token mint and
// the Clerk provisioning webhook, so local dev needs no Turso secrets. Extend
// the set as the API grows and a new route depends on secrets you'd rather not
// hold locally.
const PROD_API_BASE = (process.env.DEV_PROD_API_BASE ?? "https://jiten.tokyo").replace(/\/+$/, "");
const FORWARD_TO_PROD = new Set(["/api/turso-token", "/api/provision-db"]);

dev.use("*", async (c, next) => {
  const { pathname, search } = new URL(c.req.url);
  if (!FORWARD_TO_PROD.has(pathname)) return next();

  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  const method = c.req.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer();
  const target = `${PROD_API_BASE}${pathname}${search}`;

  try {
    const upstream = await fetch(target, { method, headers, body });
    const resBody = await upstream.arrayBuffer();
    const ct = upstream.headers.get("content-type");
    return c.body(
      resBody,
      upstream.status as ContentfulStatusCode,
      ct ? { "content-type": ct } : {},
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Forward to ${target} failed:`, msg);
    return c.json({ error: `Failed to forward to prod API (${PROD_API_BASE}): ${msg}` }, 502);
  }
});

// Static dict files first: serveStatic calls next() on a miss, so /api and
// /proxy fall through to the app. GET-only, so POST routes are never intercepted.
dev.get("/*", serveStatic({ root: "./assets" }));
dev.route("/", app);

// Surface missing API secrets up front — the locally-served routes 500 without
// them, and it's easy to lose an afternoon to a per-request "Server
// misconfigured". Only the routes served locally are listed; the Turso routes
// forward to prod (see FORWARD_TO_PROD), so their secrets aren't needed here.
// serve:dev loads .env via node's --env-file; add missing keys there (see README).
const NEEDED_SECRETS = ["CLERK_SECRET_KEY", "OPENAI_API_KEY"];
const missing = NEEDED_SECRETS.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(
    `⚠️  Missing API env vars — AI routes will return 500: ${missing.join(", ")}.\n` +
      `   Add them to .env (see README → "Dev Server"). Static/proxy/Turso still work without them.`,
  );
}

// Bind to loopback by default — this server loads real API secrets, so it must
// not be exposed to the LAN. Set DEV_HOST=0.0.0.0 to opt into LAN access (e.g.
// to reach it from a device on the same network).
const HOST = process.env.DEV_HOST ?? "127.0.0.1";
serve({ fetch: dev.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`jiten dev server (API + data) on http://${HOST}:${info.port}`);
});
