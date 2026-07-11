import { getRequestListener } from "@hono/node-server";

import { app } from "../server/app";

// Node runtime (Clerk backend isn't Edge-compatible). getRequestListener adapts
// Vercel's Node (req, res) call to app.fetch and writes the response — whereas
// hono/vercel's handle returns a Response Node discards, hanging every request.
export default getRequestListener(app.fetch);
