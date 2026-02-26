export const config = { runtime: "edge" };

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/dict\//, "");

  if (!path) {
    return new Response("Not found", { status: 404 });
  }

  const githubUrl = `https://github.com/TraderSamwise/jiten-data/releases/download/v1/${path}`;

  // fetch() in edge runtime follows redirects by default,
  // so the 302 from GitHub → Azure Blob is resolved server-side
  const upstream = await fetch(githubUrl);

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/octet-stream");
  const cl = upstream.headers.get("Content-Length");
  if (cl) headers.set("Content-Length", cl);
  headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
