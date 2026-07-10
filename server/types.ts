// Per-request context values set by middleware and read by handlers. Kept in its
// own module so app.ts and the middleware share the type without a cycle.
export type AppVariables = {
  userId: string;
};
