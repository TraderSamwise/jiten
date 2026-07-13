import { describe, expect, it } from "vitest";
import { classifyOpenError, isClosedUserDbConnectionError } from "./db-errors";

describe("classifyOpenError", () => {
  it("treats a raw SQLITE_IOERR (code 10) as transient io, not fatal", () => {
    // The exact shape seen in the wild when the OPFS release handshake times out
    // while the holding tab is busy — must NOT escalate to the recovery screen.
    expect(classifyOpenError(new Error("Error: Error: Error code 10: disk I/O error"))).toBe("io");
    expect(classifyOpenError("disk I/O error")).toBe("io");
  });

  it("classifies recognised OPFS lock messages as lock", () => {
    for (const msg of [
      "createSyncAccessHandle failed",
      "NoModificationAllowedError",
      "Access Handles cannot be created",
      "Invalid VFS state",
    ]) {
      expect(classifyOpenError(new Error(msg))).toBe("lock");
    }
  });

  it("treats anything else as fatal", () => {
    expect(classifyOpenError(new Error("no such table: lists"))).toBe("fatal");
    expect(classifyOpenError("malformed database schema")).toBe("fatal");
  });
});

describe("isClosedUserDbConnectionError", () => {
  it("matches the benign reconnect-race message", () => {
    expect(isClosedUserDbConnectionError(new Error("Null connection"))).toBe(true);
    expect(isClosedUserDbConnectionError(new Error("disk I/O error"))).toBe(false);
  });
});
