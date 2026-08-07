import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import { maxBodyBytes } from "./bodySize";

function makeApp(limit: number) {
  return new Hono().post("/probe", maxBodyBytes(limit), (c) => c.json({ ok: true }));
}

describe("maxBodyBytes", () => {
  test("passes a body under the limit through to the handler", async () => {
    const res = await makeApp(1024).request("/probe", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "12" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
  });

  test("rejects an oversized body with 413 before it is read", async () => {
    const res = await makeApp(16).request("/probe", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "5000" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Request body is too large" });
  });

  test("leaves the body readable — the stream is never wrapped", async () => {
    // The bug this replaced: wrapping the stream made the first read hang forever.
    const app = new Hono().post("/probe", maxBodyBytes(1024), async (c) => {
      const body = await c.req.json();
      return c.json({ echoed: body });
    });
    const res = await app.request("/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word: "食べる" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echoed: { word: "食べる" } });
  });

  test("allows a request that declares no length", async () => {
    const res = await makeApp(16).request("/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: "x".repeat(100) }),
    });
    expect(res.status).toBe(200);
  });

  test("ignores a malformed content-length rather than rejecting", async () => {
    const res = await makeApp(16).request("/probe", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "not-a-number" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
  });
});
