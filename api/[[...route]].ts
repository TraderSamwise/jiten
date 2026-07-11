import { handle } from "hono/vercel";

import { app } from "../server/app";

// Edge runtime: hono/vercel's handle is fetch-style ((req) => app.fetch(req)),
// which Edge invokes with a real Web Request (raw body intact for svix). On the
// Node runtime Vercel calls (req, res), discards the Response, and hangs.
export const config = { runtime: "edge" };

export default handle(app);
