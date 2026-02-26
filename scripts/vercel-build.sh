#!/bin/bash
set -e

# 1. Build the web app
yarn build:reader
npx expo export --platform web

# 2. Create Vercel Build Output API structure
rm -rf .vercel/output
mkdir -p .vercel/output/static
cp -r dist/* .vercel/output/static/

# 3. Create edge function for dictionary data proxy
FUNC_DIR=".vercel/output/functions/api/dict.func"
mkdir -p "$FUNC_DIR"

cat > "$FUNC_DIR/index.js" << 'FUNC'
export default async function handler(request) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "";

  if (!path) {
    return new Response("Not found", { status: 404 });
  }

  const githubUrl =
    "https://github.com/TraderSamwise/jiten-data/releases/download/v1/" + path;

  // fetch() follows the 302 redirect from GitHub to Azure Blob server-side
  const upstream = await fetch(githubUrl);

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Content-Type",
    upstream.headers.get("Content-Type") || "application/octet-stream"
  );
  const cl = upstream.headers.get("Content-Length");
  if (cl) headers.set("Content-Length", cl);
  headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
FUNC

cat > "$FUNC_DIR/.vc-config.json" << 'CONFIG'
{
  "runtime": "edge",
  "entrypoint": "index.js"
}
CONFIG

# 4. Create routing config
cat > ".vercel/output/config.json" << 'CONFIG'
{
  "version": 3,
  "routes": [
    { "handle": "filesystem" },
    {
      "src": "/api/dict/(.*)",
      "dest": "/api/dict?path=$1"
    },
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ]
}
CONFIG

echo "Vercel Build Output ready"
