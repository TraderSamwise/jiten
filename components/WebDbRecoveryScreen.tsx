import { useState, useEffect } from "react";
import { View, ScrollView, Pressable, Platform, StyleSheet, Text } from "react-native";
import * as SQLite from "expo-sqlite";
import type { WrappedUserDb } from "@/db/user-db";

interface RecoveryError {
  message: string;
  source: string;
  stack?: string;
}

interface WebDbRecoveryScreenProps {
  error: RecoveryError;
  onDismiss: () => void;
}

// Module-level DB ref — set by user-provider.web.tsx after init
let recoveryDb: WrappedUserDb | null = null;

export function setRecoveryDb(db: WrappedUserDb | null) {
  recoveryDb = db;
}

export function getRecoveryDb(): WrappedUserDb | null {
  return recoveryDb;
}

interface BackupResult {
  tables: Record<string, any[]>;
  succeeded: string[];
  failed: string[];
}

const BACKUP_TABLES: {
  name: string;
  query: string;
}[] = [
  {
    name: "lists",
    query:
      "SELECT id, name, description, flashcard_mode, front_faces, back_faces, study_position, configured, auto_play_audio, confusion_detection, voice_mode, typing_mode, disable_flip_animation, disable_swipe_animation, is_default, learning_steps, relearning_steps, created_at, updated_at FROM lists",
  },
  {
    name: "list_entries",
    query: "SELECT id, list_id, entry_id, kanji_literal, added_at, updated_at FROM list_entries",
  },
  {
    name: "srs_cards",
    query:
      "SELECT id, entry_id, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, front_mode, back_mode, simple_stage, simple_n, simple_interval, last_confusion_check, kanji_literal, learning_steps, created_at, updated_at FROM srs_cards",
  },
  {
    name: "review_logs",
    query:
      "SELECT id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at FROM review_logs",
  },
  {
    name: "books",
    query:
      "SELECT id, title, author, source, scroll_position, char_offset, total_chars, font_size, last_read_at, is_default, saved, created_at, updated_at FROM books",
  },
  { name: "user_kanji_notes", query: "SELECT literal, mnemonic, keyword FROM user_kanji_notes" },
  {
    name: "practice_sessions",
    query:
      "SELECT id, session_id, list_id, practice_mode, started_at, duration_ms, total_items, correct_count FROM practice_sessions",
  },
  {
    name: "game_scores",
    query:
      "SELECT id, list_id, game_type, game_mode, speed_preset, score, matches_made, triples_made, max_combo, accuracy, duration_ms, played_at FROM game_scores",
  },
];

async function attemptBackup(db: WrappedUserDb): Promise<BackupResult> {
  const result: BackupResult = { tables: {}, succeeded: [], failed: [] };
  for (const table of BACKUP_TABLES) {
    try {
      const rows = await db.getAllAsync<any>(table.query);
      result.tables[table.name] = rows;
      result.succeeded.push(table.name);
    } catch (err) {
      console.error(`[Recovery] Failed to backup ${table.name}:`, err);
      result.failed.push(table.name);
    }
  }
  return result;
}

function downloadBackup(backup: BackupResult) {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: backup.tables,
    succeeded: backup.succeeded,
    failed: backup.failed,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jiten-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function resetDatabase() {
  try {
    await SQLite.deleteDatabaseAsync("user.db");
  } catch {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("user.db");
    } catch {}
  }
  window.location.reload();
}

export function WebDbRecoveryScreen({ error, onDismiss }: WebDbRecoveryScreenProps) {
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

      {/* Backup section */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Data Backup</Text>
        {backupState === "no-db" && (
          <Text style={s.infoText}>Database could not be opened. Backup is not available.</Text>
        )}
        {backupState === "idle" && (
          <Text style={s.infoText}>Attempt to back up your data before resetting.</Text>
        )}
        {backupState === "running" && <Text style={s.infoText}>Backing up tables...</Text>}
        {backupState === "done" && backup && (
          <>
            <Text style={s.successText}>
              Backed up {backup.succeeded.length} table{backup.succeeded.length !== 1 ? "s" : ""}
              {backup.failed.length > 0 &&
                ` (${backup.failed.length} failed: ${backup.failed.join(", ")})`}
            </Text>
          </>
        )}
      </View>

      {/* Sync status */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Cloud Sync</Text>
        <Text style={s.infoText}>{syncInfo ?? "Not signed in \u2014 local data only"}</Text>
        {!syncInfo && (
          <Text style={s.warningText}>Resetting will permanently delete all local data.</Text>
        )}
      </View>

      {/* Actions */}
      {backupState === "idle" && (
        <Pressable style={s.button} onPress={runBackup}>
          <Text style={s.buttonText}>Back Up Data</Text>
        </Pressable>
      )}

      {backupState === "done" && backup && (
        <Pressable style={s.button} onPress={() => downloadBackup(backup)}>
          <Text style={s.buttonText}>Download Backup</Text>
        </Pressable>
      )}

      <Pressable style={s.buttonDanger} onPress={resetDatabase}>
        <Text style={s.buttonText}>Reset Database</Text>
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
    marginTop: 4,
  },
  button: {
    backgroundColor: "#2196F3",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  buttonDanger: {
    backgroundColor: "#d32f2f",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
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
    marginTop: 4,
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
