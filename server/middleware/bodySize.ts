import type { MiddlewareHandler } from "hono";

import type { AppVariables } from "../types";

/**
 * Coarse pre-parse size guard, replacing hono's `bodyLimit`.
 *
 * `bodyLimit` wraps the request body in a counting stream. Under the Node adapter
 * used on Vercel (`getRequestListener`, see api/[...route].ts) that wrapper never
 * completes: the route hangs on the first read of the body until the platform
 * kills the function at its timeout. Every AI route did this in production.
 *
 * Checking Content-Length costs nothing and leaves the stream untouched. A request
 * that omits the header isn't rejected here — the platform caps request bodies
 * well below anything dangerous, and the zod schemas truncate every field.
 */
export const maxBodyBytes = (limit: number): MiddlewareHandler<{ Variables: AppVariables }> => {
  return async (c, next) => {
    const header = c.req.header("content-length");
    if (header) {
      const declared = Number(header);
      if (Number.isFinite(declared) && declared > limit) {
        return c.json({ error: "Request body is too large" }, 413);
      }
    }
    await next();
  };
};
