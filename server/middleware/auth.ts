import type { MiddlewareHandler } from "hono";

import { ApiError, verifyClerkToken } from "../../api/_shared/auth";
import type { AppVariables } from "../types";

// Require a valid Clerk bearer token; stash the userId for downstream middleware
// and handlers. Thrown ApiErrors are mapped by app.onError.
export const authMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing authorization header");
  }
  const { userId } = await verifyClerkToken(authHeader.slice(7));
  c.set("userId", userId);
  await next();
};
