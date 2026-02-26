/**
 * Dev server: serves dictionary.db and dict-manifest.json from assets/
 * with CORS headers so the web app can download them.
 *
 * Usage: npx tsx scripts/serve-dict.ts
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";

const PORT = 3001;
const ASSETS_DIR = path.resolve(__dirname, "..", "assets");

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".db": "application/octet-stream",
};

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const fileName = path.basename(req.url ?? "/");
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
  console.log(`Dict server running at http://localhost:${PORT}`);
  console.log(`  Manifest: http://localhost:${PORT}/dict-manifest.json`);
  console.log(`  Database: http://localhost:${PORT}/dictionary.db`);
  console.log(`  Audio:    http://localhost:${PORT}/dictionary-audio.db`);
});
