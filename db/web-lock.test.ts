/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(public readonly name: string) {
    const set = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>();
    set.add(this);
    FakeBroadcastChannel.channels.set(name, set);
  }

  postMessage(data: string) {
    const peers = FakeBroadcastChannel.channels.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent<string>));
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset() {
    FakeBroadcastChannel.channels.clear();
  }
}

describe("web-lock", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeBroadcastChannel.reset();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    (globalThis as any).__expoSqliteCloseVFS = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs prerelease callbacks and resolves ensureLockAvailable when another tab requests release", async () => {
    const { onReleaseRequested, ensureLockAvailable } = await import("./web-lock");
    const prerelease = vi.fn();

    onReleaseRequested(prerelease);
    await expect(ensureLockAvailable()).resolves.toBe(true);

    expect(prerelease).toHaveBeenCalledOnce();
    expect((globalThis as any).__expoSqliteCloseVFS).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent release requests onto one pending promise", async () => {
    const { ensureLockAvailable } = await import("./web-lock");
    const first = ensureLockAvailable();
    const second = ensureLockAvailable();

    expect(first).toBe(second);
    await expect(first).resolves.toBe(true);
    expect((globalThis as any).__expoSqliteCloseVFS).toHaveBeenCalledOnce();
  });
});
