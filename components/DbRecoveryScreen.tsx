import { useState, useEffect } from "react";
import { View, ScrollView, Pressable, Platform, StyleSheet, Text } from "react-native";
import * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "@/db/user-db";
import { attemptBackup, BACKUP_TABLES, type BackupResult } from "@/lib/data-backup";
import { saveAndShareFile } from "@/lib/file-transfer";

interface RecoveryError {
  message: string;
  source: string;
  stack?: string;
}

interface DbRecoveryScreenProps {
  error: RecoveryError;
  onDismiss: () => void;
}

// Module-level DB ref — set by user-provider after init
let recoveryDb: WrappedUserDb | null = null;
// Module-level auth state — set by app layout after auth loads
let isUserSignedIn = false;

export function setRecoveryDb(db: WrappedUserDb | null) {
  recoveryDb = db;
}

export function getRecoveryDb(): WrappedUserDb | null {
  return recoveryDb;
}

export function setRecoverySignedIn(signedIn: boolean) {
  isUserSignedIn = signedIn;
}

async function saveBackupFile(backup: BackupResult) {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: backup.tables,
    succeeded: backup.succeeded,
    failed: backup.failed,
  };
  const date = new Date().toISOString().slice(0, 10);
  await saveAndShareFile(
    `jiten-backup-${date}.json`,
    JSON.stringify(data, null, 2),
    "application/json",
  );
}

async function resetDatabase() {
  try {
    await SQLite.deleteDatabaseAsync("user.db");
  } catch {
    if (Platform.OS === "web") {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry("user.db");
      } catch {}
    }
  }
  if (Platform.OS === "web") {
    window.location.reload();
  } else {
    try {
      const Updates = await import("expo-updates");
      await Updates.reloadAsync();
    } catch {
      // reloadAsync can fail — user must manually restart
    }
  }
}

export function DbRecoveryScreen({ error, onDismiss }: DbRecoveryScreenProps) {
  const dark = Platform.OS === "web" ? document.documentElement.classList.contains("dark") : false;
  const s = dark ? darkStyles : styles;

  const [backupState, setBackupState] = useState<"idle" | "running" | "done" | "no-db">(
    recoveryDb ? "idle" : "no-db",
  );
  const [backup, setBackup] = useState<BackupResult | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [showStack, setShowStack] = useState(false);

  useEffect(() => {
    if (!recoveryDb) return;
    // Try to get sync status
    recoveryDb
      .getFirstAsync<{ value: string }>("SELECT value FROM sync_meta WHERE key = 'last_sync_at'")
      .then((row) => {
        if (row?.value) {
          const date = new Date(row.value);
          const ago = formatTimeAgo(date);
          setSyncInfo(`Last synced ${ago}`);
        }
      })
      .catch(() => {});
  }, []);

  const runBackup = async () => {
    if (!recoveryDb) return;
    setBackupState("running");
    try {
      const result = await attemptBackup(recoveryDb);
      setBackup(result);
    } catch (err) {
      console.error("[Recovery] Backup failed entirely:", err);
      setBackup({ tables: {}, succeeded: [], failed: BACKUP_TABLES.map((t) => t.name) });
    }
    setBackupState("done");
  };

  const isSynced = isUserSignedIn && !!syncInfo;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.title}>Database Error</Text>

      <View style={s.section}>
        <Text style={s.sectionTitle}>{error.source}</Text>
        <Text style={s.errorMessage}>{error.message}</Text>
      </View>

      {error.stack && (
        <Pressable onPress={() => setShowStack(!showStack)}>
          <Text style={s.toggleText}>{showStack ? "Hide" : "Show"} Stack Trace</Text>
        </Pressable>
      )}
      {error.stack && showStack && (
        <View style={s.section}>
          <Text style={s.stackTrace}>{error.stack}</Text>
        </View>
      )}

      {/* Recovery instructions */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>How to recover</Text>
        {isSynced ? (
          <>
            <Text style={s.infoText}>
              Your data is backed up to the cloud ({syncInfo}).
              {"\n\n"}
              <Text style={s.stepLabel}>Step 1:</Text> Try "Force Sync" below — this resets the
              local database and re-downloads your data from the cloud. No data will be lost.
              {"\n\n"}
              <Text style={s.stepLabel}>Step 2:</Text> If that doesn't work, you can download a
              local backup first, then reset manually.
            </Text>
          </>
        ) : (
          <>
            <Text style={s.infoText}>
              {syncInfo && !isUserSignedIn
                ? `You previously synced (${syncInfo}) but are currently signed out.`
                : "You are not signed in, so there is no cloud backup."}
              {"\n\n"}
              {syncInfo && !isUserSignedIn ? (
                <>
                  <Text style={s.stepLabel}>Step 1:</Text> Sign in first — then "Force Sync" will
                  restore your data from the cloud after resetting.
                  {"\n\n"}
                  <Text style={s.stepLabel}>Step 2:</Text> If you can't sign in, download a local
                  backup below before resetting.
                </>
              ) : (
                <>
                  <Text style={s.stepLabel}>Step 1:</Text> Download a backup of your local data.
                  This saves your lists, flashcard progress, books, and stats as a JSON file.
                  {"\n\n"}
                  <Text style={s.stepLabel}>Step 2:</Text> Reset the database to clear the
                  corruption.
                  {"\n\n"}
                  <Text style={s.stepLabel}>Tip:</Text> Sign in to enable cloud sync — your data
                  will be automatically backed up and restored across devices.
                </>
              )}
            </Text>
            <Text style={s.warningText}>
              Without a backup or cloud sync, resetting will permanently delete all local data.
            </Text>
          </>
        )}
      </View>

      {/* Backup section */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Local Backup</Text>
        {backupState === "no-db" && (
          <Text style={s.infoText}>Database could not be opened. Backup is not available.</Text>
        )}
        {backupState === "idle" && (
          <Text style={s.infoText}>
            Attempt to back up your data before resetting. This reads each table individually — even
            if some fail, you'll get a partial backup.
          </Text>
        )}
        {backupState === "running" && <Text style={s.infoText}>Backing up tables...</Text>}
        {backupState === "done" && backup && (
          <Text style={s.successText}>
            Backed up {backup.succeeded.length} table{backup.succeeded.length !== 1 ? "s" : ""}
            {backup.failed.length > 0 &&
              ` (${backup.failed.length} failed: ${backup.failed.join(", ")})`}
          </Text>
        )}
      </View>

      {/* Actions */}

      {/* Force sync — primary action for signed-in users */}
      {isSynced && (
        <Pressable style={s.buttonSuccess} onPress={resetDatabase}>
          <Text style={s.buttonText}>Force Sync</Text>
          <Text style={s.buttonSubtext}>Reset local database and restore from cloud</Text>
        </Pressable>
      )}

      {/* Sign in — navigate directly, skips DB load */}
      {!isUserSignedIn && (
        <Pressable
          style={s.buttonSuccess}
          onPress={() => {
            if (Platform.OS === "web") {
              window.location.href = "/sign-in";
            }
            // On native, auth is handled differently — user can dismiss and navigate
          }}
        >
          <Text style={s.buttonText}>Sign In</Text>
          <Text style={s.buttonSubtext}>
            {syncInfo
              ? "Sign in to restore your data from the cloud"
              : "Enable cloud sync to protect your data"}
          </Text>
        </Pressable>
      )}

      {backupState === "idle" && (
        <Pressable style={s.button} onPress={runBackup}>
          <Text style={s.buttonText}>Back Up Data</Text>
        </Pressable>
      )}

      {backupState === "done" && backup && (
        <Pressable style={s.button} onPress={() => saveBackupFile(backup)}>
          <Text style={s.buttonText}>Download Backup</Text>
        </Pressable>
      )}

      <Pressable style={s.buttonDanger} onPress={resetDatabase}>
        <Text style={s.buttonText}>Reset Database</Text>
        <Text style={s.buttonSubtext}>
          {isSynced
            ? "Delete local data (cloud data is safe)"
            : "Delete all local data — cannot be undone"}
        </Text>
      </Pressable>

      <Pressable style={s.buttonOutline} onPress={onDismiss}>
        <Text style={s.buttonOutlineText}>Dismiss</Text>
      </Pressable>
    </ScrollView>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#d32f2f",
    marginBottom: 16,
  },
  section: {
    marginBottom: 12,
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 14,
    color: "#d32f2f",
    fontFamily: "monospace",
  },
  stackTrace: {
    fontSize: 10,
    color: "#666",
    fontFamily: "monospace",
  },
  toggleText: {
    fontSize: 13,
    color: "#2196F3",
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#333",
  },
  successText: {
    fontSize: 14,
    color: "#2e7d32",
  },
  warningText: {
    fontSize: 13,
    color: "#e65100",
    marginTop: 8,
  },
  stepLabel: {
    fontWeight: "700",
  },
  button: {
    backgroundColor: "#2196F3",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  buttonSuccess: {
    backgroundColor: "#2e7d32",
    padding: 14,
    borderRadius: 8,
    alignItems: "center" as const,
    marginTop: 16,
  },
  buttonDanger: {
    backgroundColor: "#d32f2f",
    padding: 14,
    borderRadius: 8,
    alignItems: "center" as const,
    marginTop: 10,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonSubtext: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    marginTop: 2,
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: "#2196F3",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  buttonOutlineText: {
    color: "#2196F3",
    fontSize: 16,
    fontWeight: "600",
  },
});

const darkStyles = StyleSheet.create({
  ...styles,
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  section: { marginBottom: 12, padding: 12, backgroundColor: "#1a1a1a", borderRadius: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: "#999", marginBottom: 4 },
  errorMessage: {
    fontSize: 14,
    color: "#ef5350",
    fontFamily: "monospace",
  },
  stackTrace: {
    fontSize: 10,
    color: "#999",
    fontFamily: "monospace",
  },
  toggleText: {
    fontSize: 13,
    color: "#42a5f5",
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#ccc",
  },
  successText: {
    fontSize: 14,
    color: "#66bb6a",
  },
  warningText: {
    fontSize: 13,
    color: "#ff9800",
    marginTop: 8,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#ef5350", marginBottom: 16 },
  buttonOutline: {
    borderWidth: 1,
    borderColor: "#2196F3",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  buttonOutlineText: { color: "#42a5f5", fontSize: 16, fontWeight: "600" },
});
