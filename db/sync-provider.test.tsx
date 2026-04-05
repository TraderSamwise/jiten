/**
 * Sync provider integration tests.
 *
 * Renders the real SyncProvider with mocked dependencies (DB, Turso, sync engine)
 * and tests timing, dirty flags, foreground/background behavior, and the sync loop.
 *
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AppState } from "react-native";
import { createTestDb } from "@/test/test-db";
import type { WrappedUserDb } from "./user-db";

// ---------------------------------------------------------------------------
// Mocks — must be before SyncProvider import
// ---------------------------------------------------------------------------

const mockSync = vi.fn().mockResolvedValue({ ok: true, pulled: 0, pushed: 0 });

vi.mock("./sync-engine", () => ({
  sync: (...args: any[]) => mockSync(...args),
  isNetworkError: () => false,
}));

vi.mock("./turso-client", () => ({
  createTursoClient: () => ({ execute: vi.fn(), batch: vi.fn() }),
  isSyncEnabled: () => true,
}));

vi.mock("@/lib/turso-token", () => ({
  getTursoToken: vi.fn().mockResolvedValue("mock-token"),
}));

let mockUserDb: WrappedUserDb | null = null;

vi.mock("./user-provider", () => ({
  useUserDb: () => mockUserDb,
}));

vi.mock("./provider", () => ({
  useDatabase: () => ({ dictDb: null, audioDb: null, triggerBackgroundDownloads: vi.fn() }),
}));

vi.mock("@/stores/bookmarks", () => ({
  useBookmarkStore: Object.assign(() => ({}), {
    getState: () => ({ load: vi.fn().mockResolvedValue(undefined) }),
  }),
}));

vi.mock("@/stores/lists", () => ({
  useListsStore: Object.assign(() => ({}), {
    getState: () => ({ load: vi.fn().mockResolvedValue(undefined) }),
  }),
}));

vi.mock("@/lib/last-user", () => ({
  getLastUser: vi.fn().mockResolvedValue("test-user"),
  setLastUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./sync-helpers", () => ({
  resetLocalUserData: vi.fn().mockResolvedValue(undefined),
  hasLocalData: vi.fn().mockResolvedValue(false),
}));

import { SyncProvider, useSync, SYNC_INTERVAL_MS, FORCE_SYNC_EVERY_N } from "./sync-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(userId = "test-user") {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SyncProvider userId={userId} getToken={async () => "mock-token"}>
        {children}
      </SyncProvider>
    );
  };
}

/**
 * Flush all pending promises and timers. With fake timers, we need to
 * repeatedly advance by 0 and yield to the microtask queue until everything
 * settles. The init flow has chained async effects (reconciliation → turso
 * token → dirty check → triggerSync) so we need multiple rounds.
 */
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    vi.advanceTimersByTime(0);
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Advance fake timers by ms and settle */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await settle(5);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncProvider", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createTestDb();
    mockUserDb = db;
    mockSync.mockClear();
    mockSync.mockResolvedValue({ ok: true, pulled: 0, pushed: 0 });
    (AppState as any)._reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    db.close();
    mockUserDb = null;
  });

  // -------------------------------------------------------------------------
  // Initial sync
  // -------------------------------------------------------------------------

  it("triggers sync on mount when last sync was long ago", async () => {
    renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    expect(mockSync).toHaveBeenCalled();
  });

  it("skips initial sync when last sync was recent", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("triggers sync on mount when dirty flag is persisted", async () => {
    // Set both recent sync AND dirty flag — dirty should win
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", ["sync_dirty", "1"]);
    renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    expect(mockSync).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // markDirty
  // -------------------------------------------------------------------------

  it("markDirty persists sync_dirty to the database", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    const { result } = renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    mockSync.mockClear();

    act(() => {
      result.current.markDirty();
    });
    await settle();

    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_meta WHERE key = ?",
      ["sync_dirty"],
    );
    expect(row?.value).toBe("1");
  });

  // -------------------------------------------------------------------------
  // Sync loop — dirty-gated with force every Nth tick
  // -------------------------------------------------------------------------

  it("sync loop skips when not dirty", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    mockSync.mockClear();

    // Advance through several ticks — not enough for force sync
    for (let i = 0; i < FORCE_SYNC_EVERY_N - 1; i++) {
      await advance(SYNC_INTERVAL_MS);
    }
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("sync loop fires when dirty", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    const { result } = renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    mockSync.mockClear();

    act(() => {
      result.current.markDirty();
    });
    await advance(SYNC_INTERVAL_MS);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it("sync loop force-fires at the Nth tick even when clean", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    mockSync.mockClear();

    // Advance through N ticks
    await advance(SYNC_INTERVAL_MS * FORCE_SYNC_EVERY_N);
    expect(mockSync).toHaveBeenCalled();
  });

  it("successful sync clears dirty flag from database", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    const { result } = renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();

    // Mark dirty
    act(() => {
      result.current.markDirty();
    });
    await settle();

    // Verify dirty is set
    let row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_meta WHERE key = ?",
      ["sync_dirty"],
    );
    expect(row?.value).toBe("1");

    // Trigger sync via loop tick
    await advance(SYNC_INTERVAL_MS);
    // Wait for the 500ms progress bar delay
    await advance(600);
    await settle();

    // Dirty flag should be cleared from DB
    row = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_meta WHERE key = ?", [
      "sync_dirty",
    ]);
    expect(row).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Foreground / background
  // -------------------------------------------------------------------------

  it("going to background fires silent sync when dirty", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    const { result } = renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    mockSync.mockClear();

    act(() => {
      result.current.markDirty();
    });
    act(() => {
      (AppState as any)._simulateChange("background");
    });
    await settle();
    expect(mockSync).toHaveBeenCalled();
  });

  it("going to background skips when not dirty", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    mockSync.mockClear();

    act(() => {
      (AppState as any)._simulateChange("background");
    });
    await settle();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("returning to foreground fires sync when dirty", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    const { result } = renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    mockSync.mockClear();

    act(() => {
      result.current.markDirty();
    });
    act(() => {
      (AppState as any)._simulateChange("active");
    });
    await settle();
    expect(mockSync).toHaveBeenCalled();
  });

  it("returning to foreground fires sync when elapsed >= interval", async () => {
    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    mockSync.mockClear();

    // Advance past the sync interval (simulating time in background)
    await advance(SYNC_INTERVAL_MS + 1000);
    mockSync.mockClear();

    act(() => {
      (AppState as any)._simulateChange("active");
    });
    await settle();
    expect(mockSync).toHaveBeenCalled();
  });

  it("returning to foreground skips when clean and recently synced", async () => {
    // Mount and let initial sync run (sets lastSyncCompletedRef)
    renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    // Wait for the 500ms progress bar delay
    await advance(600);
    await settle();
    mockSync.mockClear();

    // Immediately go background → foreground
    act(() => {
      (AppState as any)._simulateChange("background");
    });
    act(() => {
      (AppState as any)._simulateChange("active");
    });
    await settle();
    expect(mockSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // triggerSync marks dirty
  // -------------------------------------------------------------------------

  it("triggerSync marks dirty flag in database before syncing", async () => {
    // Hold the sync open so it doesn't clear the dirty flag before we check
    let resolveSync: (v: any) => void;
    mockSync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    await db.runAsync("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [
      "last_sync_completed_at",
      new Date().toISOString(),
    ]);
    const { result } = renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();
    // Initial sync skipped (recent last_sync_completed_at, not dirty)

    // Call triggerSync (the public API used by list import, delete, etc.)
    await act(async () => {
      result.current.triggerSync();
    });
    await settle();

    // Dirty flag should have been set in the database
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_meta WHERE key = ?",
      ["sync_dirty"],
    );
    expect(row?.value).toBe("1");
    // And sync should have been called
    expect(mockSync).toHaveBeenCalled();

    // Clean up: resolve the pending sync
    await act(async () => {
      resolveSync!({ ok: true, pulled: 0, pushed: 0 });
    });
    await advance(600);
    await settle();
  });

  it("triggerSync persists dirty flag even when sync is already in progress", async () => {
    // Make sync take a while so we can trigger a second one during it
    let resolveSync: (v: any) => void;
    mockSync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    const { result } = renderHook(() => useSync(), { wrapper: createWrapper() });
    await settle();

    // First sync is now in progress (from init). Clear the dirty flag manually
    // to simulate it being clean before the mutation.
    await db.runAsync("DELETE FROM sync_meta WHERE key = ?", ["sync_dirty"]);

    // Call triggerSync while the first sync is in progress — this is the
    // exact scenario that used to lose data (mutation during active sync).
    await act(async () => {
      result.current.triggerSync();
    });
    await settle();

    // Dirty flag must be persisted BEFORE the queued sync runs
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_meta WHERE key = ?",
      ["sync_dirty"],
    );
    expect(row?.value).toBe("1");

    // Resolve the in-progress sync so the queued one can run
    await act(async () => {
      resolveSync!({ ok: true, pulled: 0, pushed: 0 });
    });
    await settle();
    // Wait for progress bar delay
    await advance(600);
    await settle();
  });

  // -------------------------------------------------------------------------
  // Disabled sync (local user)
  // -------------------------------------------------------------------------

  it("does nothing for local user", async () => {
    const { result } = renderHook(() => useSync(), {
      wrapper: createWrapper("local"),
    });
    await settle();
    await advance(SYNC_INTERVAL_MS * FORCE_SYNC_EVERY_N);

    expect(result.current.syncStatus).toBe("disabled");
    expect(mockSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  it("SYNC_INTERVAL_MS is 30 seconds", () => {
    expect(SYNC_INTERVAL_MS).toBe(30_000);
  });

  it("FORCE_SYNC_EVERY_N is 10 (= 5 min)", () => {
    expect(FORCE_SYNC_EVERY_N).toBe(10);
    expect(SYNC_INTERVAL_MS * FORCE_SYNC_EVERY_N).toBe(300_000);
  });
});
