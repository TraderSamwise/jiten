import { hc } from "hono/client";

import type { AppType } from "../server/app";

// Typed RPC client for the Hono API. `import type { AppType }` is erased by
// Babel, so Metro never bundles server/app (and its Clerk/svix/openai deps) into
// the RN app — only the request/response TYPES flow through. Auth is per-call:
// the Clerk token is passed as a client-level header applied to every request.
export const createApiClient = (baseUrl: string, token: string) =>
  hc<AppType>(baseUrl, { headers: { Authorization: `Bearer ${token}` } });
