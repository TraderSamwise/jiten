import type { VercelRequest } from "@vercel/node";

import { ApiError } from "./auth";

export function assertJsonRequestEnvelope(req: VercelRequest, maxBodyChars: number): void {
  const contentType = req.headers["content-type"];
  if (contentType && !String(contentType).toLowerCase().includes("application/json")) {
    throw new ApiError(415, "Content-Type must be application/json");
  }

  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maxBodyChars) {
    throw new ApiError(413, "Request body is too large");
  }
  if (typeof req.body === "string" && req.body.length > maxBodyChars) {
    throw new ApiError(413, "Request body is too large");
  }
}

export function parseJsonObjectBody(
  req: VercelRequest,
  maxBodyChars: number,
): Record<string, unknown> {
  assertJsonRequestEnvelope(req, maxBodyChars);

  let body: unknown;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }

  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof req.body !== "string" && JSON.stringify(payload).length > maxBodyChars) {
    throw new ApiError(413, "Request body is too large");
  }
  return payload;
}

export function trimOptional(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function trimStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => trimOptional(item, maxItemLength))
    .filter((item): item is string => !!item)
    .slice(0, maxItems);
}
