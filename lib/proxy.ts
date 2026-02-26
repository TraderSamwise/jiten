import { Platform } from "react-native";

/**
 * On web, rewrite external URLs to go through Vercel's reverse proxy
 * to avoid CORS issues. On native, return the URL unchanged.
 *
 * Vercel rewrites (in vercel.json):
 *   /proxy/aozora/*    → https://www.aozora.gr.jp/*
 *   /proxy/syosetu-api/* → https://api.syosetu.com/*
 *   /proxy/syosetu/*   → https://ncode.syosetu.com/*
 */

const PROXY_RULES: { host: string; prefix: string }[] = [
  { host: "www.aozora.gr.jp", prefix: "/proxy/aozora" },
  { host: "api.syosetu.com", prefix: "/proxy/syosetu-api" },
  { host: "ncode.syosetu.com", prefix: "/proxy/syosetu" },
];

export function proxyUrl(url: string): string {
  if (Platform.OS !== "web") return url;

  for (const rule of PROXY_RULES) {
    const origin = `https://${rule.host}`;
    if (url.startsWith(origin)) {
      return rule.prefix + url.slice(origin.length);
    }
  }

  return url;
}
