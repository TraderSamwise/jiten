import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AppVariables } from "../types";

// Reverse-proxy for external sites that reject cross-origin/host-mismatched
// requests. Two entry forms: the query form (/api/proxy?route=&path=, hit in prod
// via vercel.json rewrites) and the path form (/proxy/:route/*, hit directly by
// the local dev server). Both funnel through handleProxy.
const ORIGINS: Record<string, string> = {
  aozora: "https://www.aozora.gr.jp",
  "syosetu-api": "https://api.syosetu.com",
  syosetu: "https://ncode.syosetu.com",
};

async function handleProxy(c: Context, route: string | undefined, path: string | undefined) {
  if (!route || !ORIGINS[route]) {
    return c.json({ error: "Unknown proxy route" }, 404);
  }

  const forward = new URLSearchParams();
  for (const [k, v] of Object.entries(c.req.query())) {
    if (k === "route" || k === "path") continue;
    forward.set(k, v);
  }
  const qs = forward.toString();
  const targetUrl = `${ORIGINS[route]}/${path ?? ""}${qs ? `?${qs}` : ""}`;
  const parsed = new URL(targetUrl);

  try {
    const upstream = await fetch(targetUrl, {
      // No explicit Host header: undici treats it as a forbidden header and sets
      // it from targetUrl's host anyway, which is already the correct upstream.
      headers: {
        referer: `https://${parsed.hostname}/`,
        "user-agent": c.req.header("user-agent") ?? "Mozilla/5.0 (compatible)",
        accept: c.req.header("accept") ?? "*/*",
      },
    });

    const ct = upstream.headers.get("content-type");
    const body = await upstream.arrayBuffer();
    return c.body(body, upstream.status as ContentfulStatusCode, ct ? { "content-type": ct } : {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Proxy error for ${targetUrl}:`, msg);
    return c.json({ error: `Proxy error: ${msg}` }, 502);
  }
}

export const proxyRoute = new Hono<{ Variables: AppVariables }>()
  .get("/api/proxy", (c) => handleProxy(c, c.req.query("route"), c.req.query("path")))
  .get("/proxy/:route/:rest{.*}", (c) => handleProxy(c, c.req.param("route"), c.req.param("rest")));
