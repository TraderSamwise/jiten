/**
 * BroadcastChannel-based inter-tab DB lock coordinator.
 *
 * expo-sqlite's web VFS (AccessHandlePoolVFS) holds a pool of OPFS
 * FileSystemSyncAccessHandle objects. db.closeAsync() only closes the
 * SQLite connection — the pool keeps the handles, blocking other tabs.
 *
 * We patch expo-sqlite (see patches/expo-sqlite+*.patch) to add a
 * `closeVFS` worker message that calls AccessHandlePoolVFS.close(),
 * releasing all OPFS handles. The patch exposes this as
 * globalThis.__expoSqliteCloseVFS().
 *
 * Both providers call ensureLockAvailable() before any DB open.
 * They share the same promise so only one "please-release" is sent.
 */

type Message = "please-release" | "released";

const CHANNEL_NAME = "jiten-db-lock";
const RELEASE_TIMEOUT_MS = 2000;

let channel: BroadcastChannel | null = null;

/** Callbacks to null out provider refs/state before VFS close */
const preReleaseCallbacks = new Set<() => void>();

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = async (event: MessageEvent<Message>) => {
      if (event.data === "please-release") {
        console.log("[web-lock] Received release request, closing VFS...");

        // Null out provider refs/state synchronously
        for (const cb of Array.from(preReleaseCallbacks)) {
          try {
            cb();
          } catch (e) {
            console.error(e);
          }
        }

        // Close the VFS to release OPFS access handles
        const closeVFS = (globalThis as any).__expoSqliteCloseVFS;
        if (closeVFS) {
          try {
            await closeVFS();
          } catch (e) {
            console.error("[web-lock] closeVFS error:", e);
          }
        }

        getChannel().postMessage("released" satisfies Message);
        console.log("[web-lock] Released, notified requesting tab");
      }
    };
  }
  return channel;
}

/**
 * Register a synchronous callback to null out DB refs/state before VFS close.
 * These run synchronously before the async closeVFS call.
 * Returns unsubscribe.
 */
export function onReleaseRequested(cb: () => void): () => void {
  preReleaseCallbacks.add(cb);
  getChannel();
  return () => {
    preReleaseCallbacks.delete(cb);
  };
}

/**
 * Ask other tabs to release their OPFS handles.
 * Sends "please-release", waits for "released" or timeout.
 */
function requestRelease(): Promise<boolean> {
  return new Promise((resolve) => {
    const ch = getChannel();
    const prev = ch.onmessage;

    const timeout = setTimeout(() => {
      ch.onmessage = prev;
      console.log("[web-lock] Release request timed out");
      resolve(false);
    }, RELEASE_TIMEOUT_MS);

    ch.onmessage = (event: MessageEvent<Message>) => {
      if (event.data === "released") {
        clearTimeout(timeout);
        ch.onmessage = prev;
        console.log("[web-lock] Other tab released");
        resolve(true);
      } else if (event.data === "please-release") {
        if (prev) (prev as any)(event);
      }
    };

    ch.postMessage("please-release" satisfies Message);
    console.log("[web-lock] Sent release request");
  });
}

/**
 * Proactively ask other tabs to release before opening any DB.
 * Both providers share the same promise so only one request is sent.
 * The cache clears after resolution so subsequent calls (e.g. on
 * visibilitychange reacquire) send a fresh request.
 */
let pending: Promise<boolean> | null = null;

export function ensureLockAvailable(): Promise<boolean> {
  if (!pending) {
    pending = requestRelease().finally(() => {
      pending = null;
    });
  }
  return pending;
}
