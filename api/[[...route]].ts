import { handle } from "hono/vercel";

import { app } from "../server/app";

// Vercel catch-all: every /api/* request runs through the single Hono app
// (fetch-style handler, so the raw body reaches the svix webhook untouched).
export default handle(app);
