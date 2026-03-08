/**
 * Dev server: serves dictionary files from assets/ and proxies external APIs
 * (Aozora, Syosetu) with CORS headers so the web app works locally.
 *
 * Usage: yarn serve:dev
 */

import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";

const PORT = 3001;
const ASSETS_DIR = path.resolve(__dirname, "..", "assets");

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".db": "application/octet-stream",
};

// Proxy rules — same as vercel.json rewrites and lib/proxy.ts
const PROXY_RULES: { prefix: string; target: string }[] = [
  { prefix: "/proxy/aozora/", target: "https://www.aozora.gr.jp/" },
  { prefix: "/proxy/syosetu-api/", target: "https://api.syosetu.com/" },
  { prefix: "/proxy/syosetu/", target: "https://ncode.syosetu.com/" },
];

function proxyRequest(
  targetUrl: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const parsed = new URL(targetUrl);

  const proxyReq = https.request(
    {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: req.method,
      headers: {
        ...Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== "origin")),
        host: parsed.hostname,
        referer: `https://${parsed.hostname}/`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 500, {
        ...proxyRes.headers,
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
      });
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    console.error(`Proxy error for ${targetUrl}:`, err.message);
    res.writeHead(502);
    res.end(`Proxy error: ${err.message}`);
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";

  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Check proxy rules
  for (const rule of PROXY_RULES) {
    if (url.startsWith(rule.prefix)) {
      const targetPath = url.slice(rule.prefix.length);
      const targetUrl = rule.target + targetPath;
      proxyRequest(targetUrl, req, res);
      return;
    }
  }

  // Serve static assets (dict files)
  const fileName = path.basename(url);
  const filePath = path.join(ASSETS_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(fileName);
  const stat = fs.statSync(filePath);

  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Content-Length": stat.size,
  });

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log();
  console.log("  Assets:");
  console.log(`    Manifest: http://localhost:${PORT}/dict-manifest.json`);
  console.log(`    Database: http://localhost:${PORT}/dictionary.db`);
  console.log(`    Audio:    http://localhost:${PORT}/dictionary-audio.db`);
  console.log();
  console.log("  Proxy:");
  for (const rule of PROXY_RULES) {
    console.log(`    ${rule.prefix}* → ${rule.target}*`);
  }
});
