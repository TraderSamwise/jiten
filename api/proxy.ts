/**
 * Vercel serverless proxy for external APIs (Syosetu, Aozora).
 *
 * Vercel rewrites don't let us set the Host header, and some upstream
 * servers (notably Syosetu) reject requests whose Host doesn't match.
 * This function fetches on behalf of the client with correct headers.
 *
 * Routes (via vercel.json rewrites with ?route=&path= query params):
 *   /proxy/aozora/*       → https://www.aozora.gr.jp/*
 *   /proxy/syosetu-api/*   → https://api.syosetu.com/*
 *   /proxy/syosetu/*       → https://ncode.syosetu.com/*
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const ORIGINS: Record<string, string> = {
  aozora: "https://www.aozora.gr.jp",
  "syosetu-api": "https://api.syosetu.com",
  syosetu: "https://ncode.syosetu.com",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const route = req.query.route as string | undefined;
  const pathParam = req.query.path as string | undefined;

  if (!route || !ORIGINS[route]) {
    return res.status(404).json({ error: "Unknown proxy route" });
  }

  // Forward original query params (exclude our routing params)
  const forwardParams = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === "route" || k === "path") continue;
    if (typeof v === "string") forwardParams.set(k, v);
  }
  const qs = forwardParams.toString();

  const origin = ORIGINS[route];
  const targetUrl = `${origin}/${pathParam ?? ""}${qs ? `?${qs}` : ""}`;
  const parsed = new URL(targetUrl);

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        host: parsed.hostname,
        referer: `https://${parsed.hostname}/`,
        "user-agent": req.headers["user-agent"] ?? "Mozilla/5.0 (compatible)",
        accept: req.headers["accept"] ?? "*/*",
      },
    });

    const ct = upstream.headers.get("content-type");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    if (ct) res.setHeader("content-type", ct);

    const body = Buffer.from(await upstream.arrayBuffer());
    return res.status(upstream.status).send(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Proxy error for ${targetUrl}:`, msg);
    return res.status(502).json({ error: `Proxy error: ${msg}` });
  }
}
