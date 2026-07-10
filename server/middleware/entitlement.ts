import type { MiddlewareHandler } from "hono";

import { assertFeatureAccess, type PremiumFeature } from "../../api/_shared/entitlements";
import type { AppVariables } from "../types";

// Gate a route on a premium feature. Runs after authMiddleware (needs userId).
export const entitlement =
  (feature: PremiumFeature): MiddlewareHandler<{ Variables: AppVariables }> =>
  async (c, next) => {
    await assertFeatureAccess(c.get("userId"), feature);
    await next();
  };
