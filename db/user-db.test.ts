import { beforeEach, describe, expect, test, vi } from "vitest";

const notifyDbError = vi.fn();

vi.mock("@/components/GlobalErrorHandler", () => ({
  notifyDbError: (...args: unknown[]) => notifyDbError(...args),
}));

import { wrapUserDb } from "./user-db";

function createRejectingDb(error: Error) {
  return {
    execute: vi.fn().mockRejectedValue(error),
    sync: vi.fn(),
  } as any;
}

describe("wrapUserDb", () => {
  beforeEach(() => {
    notifyDbError.mockClear();
  });

  test("reports live database query failures to global recovery", async () => {
    const err = new Error("SQLITE_ERROR");
    const db = createRejectingDb(err);
    const wrapped = wrapUserDb(db);

    await expect(wrapped.getFirstAsync("SELECT 1")).rejects.toThrow("SQLITE_ERROR");

    expect(notifyDbError).toHaveBeenCalledWith(err, "SELECT 1");
  });

  test("does not report stale closed database query failures to global recovery", async () => {
    const err = new Error("Null connection");
    const db = createRejectingDb(err);
    const wrapped = wrapUserDb(db, { shouldNotifyError: () => false });

    await expect(
      wrapped.getFirstAsync("SELECT value FROM sync_meta WHERE key = ?"),
    ).rejects.toThrow("Null connection");

    expect(notifyDbError).not.toHaveBeenCalled();
  });
});
