import { Platform } from "react-native";

/**
 * On web, rewrite external URLs to go through a reverse proxy to avoid CORS.
 * On native, return the URL unchanged.
 *
 * Dev:  http://localhost:3001/proxy/* (local dev server)
 * Prod: /proxy/* (Vercel rewrites in vercel.json)
 */

const PROXY_RULES: { host: string; prefix: string }[] = [
  { host: "www.aozora.gr.jp", prefix: "/proxy/aozora" },
  { host: "api.syosetu.com", prefix: "/proxy/syosetu-api" },
  { host: "ncode.syosetu.com", prefix: "/proxy/syosetu" },
];

const isDev = __DEV__;
const DEV_PROXY_ORIGIN = "http://localhost:3001";

export function proxyUrl(url: string): string {
  if (Platform.OS !== "web") return url;

  for (const rule of PROXY_RULES) {
    const origin = `https://${rule.host}`;
    if (url.startsWith(origin)) {
      const path = rule.prefix + url.slice(origin.length);
      return isDev ? DEV_PROXY_ORIGIN + path : path;
    }
  }

  return url;
}
