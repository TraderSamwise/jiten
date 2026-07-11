import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ArenaWebView } from "@/components/kanji-arena/arena-web-view";
import type { ArenaViewRef } from "@/components/kanji-arena/types";
import { Text } from "@/components/ui/text";
import { getUserDrizzle } from "@/db/drizzle";
import { useDatabase } from "@/db/provider";
import { useSync } from "@/db/sync-provider";
import { useUserDb } from "@/db/user-provider";
import { useAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { saveGameScore } from "@/lib/game-scores";
import { gradeKanjiCard } from "@/lib/kanji-arena/grade";
import { saveArenaStory } from "@/lib/kanji-arena/save-story";
import { buildArenaSession, filterCohort, type Mode } from "@/lib/kanji-arena/session";
import { requestKanjiMnemonic } from "@/lib/kanji-mnemonic-ai";
import { generateArenaHtml } from "@jiten/kanji-arena-webview/html";
import type { ArenaCard, GameMessage } from "@jiten/kanji-arena-webview/protocol";

type Phase = "loading" | "empty" | "menu" | "playing";

export default function KanjiArenaScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const router = useRouter();
  const userDb = useUserDb();
  const { dictDb, strokesDb, backgroundStatus } = useDatabase();
  const { getToken } = useAuth();
  const { markDirty } = useSync();
  const html = useMemo(() => generateArenaHtml(), []);
  const arenaRef = useRef<ArenaViewRef>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [counts, setCounts] = useState({ total: 0, learn: 0, review: 0 });
  const sessionRef = useRef<ArenaCard[]>([]);
  const playRef = useRef<ArenaCard[]>([]);
  const modeRef = useRef<Mode>("blend");
  const gameReadyRef = useRef(false);
  const practiceRef = useRef(false);
  const [editing, setEditing] = useState<{ token: string; current: string } | null>(null);
  const [draft, setDraft] = useState("");

  // primitives come from strokesDb, which opens in the background after launch.
  // Depend on the strokes load state (not the whole array) so this only re-runs
  // when it actually changes, not on every download progress tick.
  const strokesState = backgroundStatus.find((i) => i.key === "strokes")?.state;

  // Load the list-scoped learned-kanji session.
  useEffect(() => {
    if (!userDb || !dictDb) return;
    if (!listId) {
      setPhase("empty");
      return;
    }
    // Hold on the loader while strokesDb is still opening, so we never ship a
    // session where every kanji reads as "no breakdown". Proceed once it's ready
    // (strokesDb set) or terminal/absent — the effect re-runs when either flips.
    const strokesLoading =
      !strokesDb &&
      (strokesState === "pending" ||
        strokesState === "downloading" ||
        strokesState === "importing");
    if (strokesLoading) {
      setPhase("loading");
      return;
    }
    let alive = true;
    setPhase("loading");
    buildArenaSession(userDb, dictDb, strokesDb, listId, "blend")
      .then((cards) => {
        if (!alive) return;
        sessionRef.current = cards;
        setCounts({
          total: cards.length,
          learn: filterCohort(cards, "learn").length,
          review: filterCohort(cards, "review").length,
        });
        setPhase(cards.length === 0 ? "empty" : "menu");
      })
      .catch(() => {
        if (alive) setPhase("empty");
      });
    return () => {
      alive = false;
    };
  }, [userDb, dictDb, strokesDb, strokesState, listId]);

  const postSession = useCallback(() => {
    arenaRef.current?.postMessage(
      JSON.stringify({
        type: "session",
        cards: playRef.current,
        config: { mode: modeRef.current, practice: practiceRef.current },
      }),
    );
  }, []);

  const start = useCallback((mode: Mode, asPractice: boolean) => {
    practiceRef.current = asPractice;
    modeRef.current = mode;
    playRef.current = filterCohort(sessionRef.current, mode);
    gameReadyRef.current = false;
    setPhase("playing");
  }, []);

  const onMessage = useCallback(
    (data: string) => {
      let msg: GameMessage;
      try {
        msg = JSON.parse(data) as GameMessage;
      } catch {
        return;
      }
      if (msg.type === "ready") {
        gameReadyRef.current = true;
        postSession();
      } else if (msg.type === "result") {
        if (!practiceRef.current && userDb && listId) {
          gradeKanjiCard(userDb, msg.token, msg.correct, listId).catch(() => {});
        }
      } else if (msg.type === "taught") {
        // A study alcove introduced a new kanji — enroll it in the real SRS
        // (new→learning). Skipped in practice, mirroring "result".
        if (!practiceRef.current && userDb && listId) {
          gradeKanjiCard(userDb, msg.token, true, listId).catch(() => {});
        }
      } else if (msg.type === "sessionEnd" && userDb && listId) {
        const { reads, hits } = msg.summary;
        saveGameScore(getUserDrizzle(userDb), {
          listId,
          gameType: "kanji_arena",
          gameMode: practiceRef.current ? "practice" : "graded",
          speedPreset: "none",
          score: hits,
          matchesMade: reads,
          triplesMade: 0,
          maxCombo: 0,
          accuracy: reads > 0 ? Math.round((hits / reads) * 100) : 0,
          durationMs: 0,
        }).catch(() => {});
      } else if (msg.type === "requestStory") {
        const token = msg.token;
        const deliver = (text: string) =>
          arenaRef.current?.postMessage(JSON.stringify({ type: "story", token, text }));
        if (!userDb) {
          deliver(""); // recover the scene rather than leaving it on "conjuring…"
          return;
        }
        requestKanjiMnemonic({
          apiBaseUrl: env.API_BASE_URL,
          getToken,
          input: { kanji: msg.kanji, keyword: msg.keyword, primitives: msg.primitives },
        })
          .then((story) => {
            deliver(story); // show it even if the local save below fails
            saveArenaStory(userDb, strokesDb, token, story)
              .then(() => markDirty())
              .catch(() => {});
          })
          .catch(() => deliver(""));
      } else if (msg.type === "editStory") {
        setEditing({ token: msg.token, current: msg.current });
        setDraft(msg.current);
      }
    },
    [userDb, listId, postSession, getToken, strokesDb, markDirty],
  );

  const deliverStory = useCallback((token: string, text: string) => {
    arenaRef.current?.postMessage(JSON.stringify({ type: "story", token, text }));
  }, []);

  const saveEdit = useCallback(() => {
    if (!editing) return;
    const { token } = editing;
    if (userDb && draft.trim()) {
      saveArenaStory(userDb, strokesDb, token, draft)
        .then(() => markDirty())
        .catch(() => {});
    }
    deliverStory(token, draft);
    setEditing(null);
  }, [editing, draft, userDb, strokesDb, markDirty, deliverStory]);

  const cancelEdit = useCallback(() => {
    if (editing) deliverStory(editing.token, editing.current);
    setEditing(null);
  }, [editing, deliverStory]);

  if (phase === "playing") {
    return (
      <View style={{ flex: 1, backgroundColor: "#0d0b14" }}>
        <ArenaWebView ref={arenaRef} html={html} onMessage={onMessage} />
        <Modal
          visible={editing !== null}
          transparent
          animationType="fade"
          onRequestClose={cancelEdit}
        >
          <View className="flex-1 justify-center bg-black/60 px-6">
            <View
              className="rounded-2xl border border-border bg-background p-5"
              style={{ maxWidth: 500, width: "100%", alignSelf: "center" }}
            >
              <Text className="mb-1 text-lg font-semibold text-foreground">Your mnemonic</Text>
              <Text className="mb-3 text-sm text-muted-foreground">
                Write a vivid story linking the primitives to the keyword.
              </Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                multiline
                autoFocus
                textAlignVertical="top"
                placeholder="Once upon a time…"
                placeholderTextColor="#6f6a82"
                className="rounded-lg border border-border bg-muted/20 p-3 text-base text-foreground"
                style={{ minHeight: 120, maxHeight: 260 }}
              />
              <View className="mt-4 flex-row justify-end gap-3">
                <Pressable
                  onPress={cancelEdit}
                  className="rounded-lg border border-border px-4 py-2"
                >
                  <Text className="text-base text-muted-foreground">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={saveEdit}
                  className="rounded-lg border border-primary bg-primary/10 px-4 py-2"
                >
                  <Text className="text-base font-medium text-foreground">Save</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background px-6">
      <Pressable onPress={() => router.back()} className="py-4">
        <Text className="text-base text-muted-foreground">‹ Back</Text>
      </Pressable>

      <View className="flex-1 items-center justify-center">
        {phase === "loading" && <ActivityIndicator />}

        {phase === "empty" && (
          <View className="items-center gap-2">
            <Text className="text-lg font-semibold text-foreground">Kanji Arena</Text>
            <Text className="text-center text-muted-foreground">
              {listId
                ? "No learned kanji in this list yet — study some kanji first."
                : "Open Kanji Arena from a list."}
            </Text>
          </View>
        )}

        {phase === "menu" && (
          <View className="w-full items-center gap-6" style={{ maxWidth: 420 }}>
            <View className="items-center gap-1">
              <Text className="text-2xl font-semibold text-foreground">Kanji Arena</Text>
              <Text className="text-muted-foreground">{counts.total} kanji</Text>
            </View>
            <View className="w-full gap-3">
              <Pressable
                onPress={() => start("blend", false)}
                className="rounded-lg border border-primary bg-primary/10 px-4 py-4"
              >
                <Text className="text-lg font-semibold text-foreground">Play</Text>
                <Text className="text-sm text-muted-foreground">
                  Learn new and review the rest, graded in one run
                </Text>
              </Pressable>
              <View className="flex-row gap-3">
                <Pressable
                  onPress={() => start("learn", false)}
                  disabled={counts.learn === 0}
                  className="flex-1 rounded-lg border border-border px-4 py-3"
                  style={counts.learn === 0 ? { opacity: 0.4 } : undefined}
                >
                  <Text className="text-base font-medium text-foreground">Learn</Text>
                  <Text className="text-sm text-muted-foreground">
                    {counts.learn} new / learning
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => start("review", false)}
                  disabled={counts.review === 0}
                  className="flex-1 rounded-lg border border-border px-4 py-3"
                  style={counts.review === 0 ? { opacity: 0.4 } : undefined}
                >
                  <Text className="text-base font-medium text-foreground">Review</Text>
                  <Text className="text-sm text-muted-foreground">{counts.review} started</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() => start("blend", true)}
                className="rounded-lg border border-border px-4 py-3"
              >
                <Text className="text-base font-medium text-foreground">Free practice</Text>
                <Text className="text-sm text-muted-foreground">
                  Play without changing your SRS
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
