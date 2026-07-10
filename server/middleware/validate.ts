import { zValidator } from "@hono/zod-validator";
import type { z } from "zod";

// JSON body validation that fails with the app's `{ error }` shape + 400 (the
// first Zod issue message), instead of @hono/zod-validator's default payload.
export const jsonBody = <T extends z.ZodTypeAny>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: result.error.issues[0]?.message ?? "Invalid request body" }, 400);
    }
  });
