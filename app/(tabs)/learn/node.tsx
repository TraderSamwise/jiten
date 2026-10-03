import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { ChoiceDrill } from "@/components/rtk/ChoiceDrill";
import { MeetFrame } from "@/components/rtk/MeetFrame";
import { Text } from "@/components/ui/text";
import { CustomHeaderScreen } from "@/components/CustomHeaderScreen";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { useSync } from "@/db/sync-provider";
import { getPrimitivesForKanjiAsync } from "@/db/kanji-search";
import { getUserDrizzle } from "@/db/drizzle";
import { loadNodeFrames, loadSimilarPathFrames, loadUnitFrames } from "@/db/rtk-frames";
import { getNodeProgress, markNodeSeen } from "@/db/rtk-progress";
import type { KanjiPrimitive } from "@/db/types";
import { useKanjiMnemonic } from "@/hooks/useKanjiMnemonic";
import { useMnemonicGeneration, type GenerationState } from "@/hooks/useMnemonicGeneration";
import { useSafeGoBack } from "@/lib/navigation";
import { logPracticeEvent, recordConfusion } from "@/lib/practice-logger";
import { nodeId, nodeRefFromParams, type CourseFrame, type NodeStep } from "@/lib/rtk-course";
import { mnemonicRequestFor } from "@/lib/rtk-prompt";
import {
  advance,
  currentItem,
  sessionAnswered,
  sessionTotal,
  skipCurrent,
  startSession,
  type SessionState,
} from "@/lib/rtk-session";

/**
 * The steps the runner can render. Each later phase adds one, and a step that
 * is not here is never scheduled — so a session's progress counts only what it
 * will actually ask.
 */
const IMPLEMENTED_STEPS: readonly NodeStep[] = ["meet", "recognise", "identify"];

/** Both choice drills ask about the same frame; the mode separates the history. */
const CHOICE_MODE = {
  recognise: "rtk_recognise",
  identify: "rtk_identify",
} as const;

function Centred({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center p-6">{children}</View>;
}

/** The frame's own saved story and keyword; everything else is the runner's. */
function MeetStep({
  frame,
  primitives,
  generation,
  canGenerate,
  onGenerate,
  onDone,
}: {
  frame: CourseFrame;
  primitives: KanjiPrimitive[];
  generation: GenerationState;
  canGenerate: boolean;
  onGenerate: (frame: CourseFrame, keyword: string | null, fresh: boolean) => void;
  onDone: (outcome: "saved" | "skipped") => void;
}) {
  const { mnemonic, keyword, loaded, saveMnemonic, saveNote } = useKanjiMnemonic(frame.literal);

  return (
    <MeetFrame
      frame={frame}
      primitives={primitives}
      keyword={keyword}
      story={mnemonic}
      generation={generation}
      canGenerate={canGenerate}
      onGenerate={(fresh) => onGenerate(frame, keyword, fresh)}
      onSave={(text) => {
        saveMnemonic(text)
          .catch((err) => console.warn("[learn] could not save the story", err))
          .finally(() => onDone("saved"));
      }}
      onKeyword={(text) => {
        // Before the row is read, `mnemonic` is null because nothing has been
        // read — writing both fields now would erase a story never seen.
        if (!loaded) return;
        // Both fields at once: saving them separately would write one back stale.
        // A keyword equal to Heisig's is no override, so it is stored as none —
        // the same rule KanjiDetail applies.
        const own = text.trim() === frame.keyword ? "" : text;
        saveNote(mnemonic ?? "", own).catch((err) =>
          console.warn("[learn] could not save the keyword", err),
        );
      }}
      onKeep={() => onDone("saved")}
      onSkip={() => onDone("skipped")}
    />
  );
}

function ChoiceStep({
  step,
  frame,
  similar,
  unit,
  primitives,
  onAnswered,
  onDone,
  onUnaskable,
}: {
  step: "recognise" | "identify";
  frame: CourseFrame;
  similar: readonly CourseFrame[];
  unit: readonly CourseFrame[];
  primitives: KanjiPrimitive[];
  onAnswered: (result: { correct: boolean; picked: CourseFrame; responseMs: number }) => void;
  onDone: () => void;
  onUnaskable: () => void;
}) {
  const { mnemonic, keyword } = useKanjiMnemonic(frame.literal);

  return (
    <ChoiceDrill
      prompt={step === "recognise" ? "kanji" : "keyword"}
      frame={frame}
      keyword={keyword}
      similar={similar}
      unit={unit}
      story={mnemonic}
      primitives={primitives}
      onAnswer={onAnswered}
      onDone={onDone}
      onUnaskable={onUnaskable}
    />
  );
}

export default function LearnNodeScreen() {
  const { unit, node } = useLocalSearchParams<{ unit?: string; node?: string }>();
  const { dictDb, strokesDb } = useDatabase();
  const userDb = useUserDb();
  const goBack = useSafeGoBack("/learn");
  const { markDirty } = useSync();
  // Held by the runner, not the step: the story cache and the node-ahead
  // prefetch have to outlive the frame that asked for the first story.
  const { state: generation, generate, prefetch } = useMnemonicGeneration();

  const ref = useMemo(() => nodeRefFromParams(unit, node), [unit, node]);
  // One sitting of this node: a stable node id alone would collapse every pass
  // over it, on every day, into a single pseudo-session. Stamped in an effect,
  // because the clock is not a pure value to read during a render.
  const sessionTag = useRef("");
  useEffect(() => {
    sessionTag.current = ref ? `${nodeId(ref)}:${Date.now().toString(36)}` : "";
  }, [ref]);
  const [frames, setFrames] = useState<CourseFrame[] | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [primitives, setPrimitives] = useState<Map<string, KanjiPrimitive[]>>(new Map());
  const [similar, setSimilar] = useState<Map<string, CourseFrame[]>>(new Map());
  const [unitFrames, setUnitFrames] = useState<CourseFrame[]>([]);
  // Until the option pool is read, a choice drill would see one option, hand the
  // step back, and skip the whole queue before the query returned.
  const [poolReady, setPoolReady] = useState(false);
  const drizzleDb = useMemo(() => (userDb ? getUserDrizzle(userDb) : null), [userDb]);
  // Remembered between answering and moving on: the queue advances only once the
  // learner has seen the result.
  const lastResult = useRef<boolean | null>(null);

  useEffect(() => {
    if (!ref || !dictDb || !userDb) return;
    let current = true;
    // Clear first, so a param change cannot drill one node against another's frames.
    setFrames(null);
    setSession(null);
    setPoolReady(false);
    Promise.all([loadNodeFrames(dictDb, ref), getNodeProgress(userDb, ref)])
      .then(([loaded, progress]) => {
        if (!current) return;
        setFrames(loaded);
        setSession(startSession(loaded, progress?.crown ?? 0, IMPLEMENTED_STEPS));
      })
      .catch((err) => {
        if (current) setFrames([]);
        console.warn("[learn] could not open the node", err);
      });
    return () => {
      current = false;
    };
  }, [dictDb, userDb, ref]);

  // All five decompositions up front: a story for the frame after this one
  // cannot be written without them.
  useEffect(() => {
    if (!strokesDb || !frames?.length) return;
    let current = true;
    Promise.all(
      frames.map(async (frame) => {
        try {
          return [
            frame.literal,
            await getPrimitivesForKanjiAsync(strokesDb, frame.literal),
          ] as const;
        } catch {
          return [frame.literal, [] as KanjiPrimitive[]] as const;
        }
      }),
    ).then((pairs) => {
      if (current) setPrimitives(new Map(pairs));
    });
    return () => {
      current = false;
    };
  }, [strokesDb, frames]);

  // The option pool for the choice drills: each frame's lookalikes, plus the
  // whole unit for the handful of frames that have none.
  useEffect(() => {
    if (!dictDb || !frames?.length || !ref) return;
    let current = true;
    Promise.all([
      Promise.all(
        frames.map(async (frame) => {
          try {
            return [frame.literal, await loadSimilarPathFrames(dictDb, frame.literal)] as const;
          } catch {
            return [frame.literal, [] as CourseFrame[]] as const;
          }
        }),
      ),
      loadUnitFrames(dictDb, ref.unit).catch(() => [] as CourseFrame[]),
    ]).then(([pairs, unit]) => {
      if (!current) return;
      setSimilar(new Map(pairs));
      setUnitFrames(unit);
      setPoolReady(true);
    });
    return () => {
      current = false;
    };
  }, [dictDb, frames, ref]);

  // Only once the node is known to exist: a link naming a node the course does
  // not have must not leave a synced progress row behind.
  useEffect(() => {
    if (!ref || !userDb || !frames?.length) return;
    markNodeSeen(userDb, ref).catch((err) =>
      console.warn("[learn] could not record the node as seen", err),
    );
  }, [userDb, ref, frames?.length]);

  const onDone = useCallback((outcome: "saved" | "skipped") => {
    setSession((current) =>
      current ? (outcome === "saved" ? advance(current, "hit") : skipCurrent(current)) : current,
    );
  }, []);

  const onAnswered = useCallback(
    (
      step: "recognise" | "identify",
      frame: CourseFrame,
      result: { correct: boolean; picked: CourseFrame; responseMs: number },
    ) => {
      // Records the answer; the queue moves in onSeen, once the learner has
      // read the result. Advancing here too would unmount the drill at once and
      // make the pause, the reveal and its Got-it tap unreachable.
      lastResult.current = result.correct;
      if (!drizzleDb || !ref) return;
      // entry_id 0 is the kanji sentinel; the node and this sitting are the session.
      logPracticeEvent(drizzleDb, {
        entryId: 0,
        kanjiLiteral: frame.literal,
        practiceMode: CHOICE_MODE[step],
        correct: result.correct,
        responseMs: result.responseMs,
        sessionId: sessionTag.current || null,
      }).catch(() => {});
      if (!result.correct) {
        // recordConfusion orders a pair by entry id, and every kanji card is 0,
        // so (A,B) and (B,A) would make two rows. Order by literal instead.
        const [a, b] = [frame.literal, result.picked.literal].sort();
        recordConfusion(
          drizzleDb,
          { entryId: 0, kanjiLiteral: a },
          { entryId: 0, kanjiLiteral: b },
          "visual_kanji",
          undefined,
          CHOICE_MODE[step],
        ).catch(() => {});
      }
      markDirty();
    },
    [drizzleDb, ref, markDirty],
  );

  const onUnaskable = useCallback(() => {
    setSession((current) => (current ? skipCurrent(current) : current));
  }, []);

  /** The learner has seen the result; now the queue moves. */
  const onSeen = useCallback(() => {
    // Read before the updater runs: a state updater runs on the next render, so
    // clearing the ref first would make every miss look like a hit.
    const missed = lastResult.current === false;
    lastResult.current = null;
    setSession((current) => (current ? advance(current, missed ? "miss" : "hit") : current));
  }, []);

  const onGenerate = useCallback(
    (frame: CourseFrame, keyword: string | null, fresh: boolean) => {
      const request = mnemonicRequestFor(frame, primitives.get(frame.literal) ?? [], keyword);
      if (!request) return;
      generate(request, { fresh })
        .then((story) => {
          if (!story || !frames) return;
          // Only now, having been asked for one, warm the frames after this one.
          const after = frames.slice(frames.indexOf(frame) + 1);
          const requests = after
            .map((next) => mnemonicRequestFor(next, primitives.get(next.literal) ?? [], null))
            .filter((req): req is NonNullable<typeof req> => !!req);
          prefetch(requests).catch(() => {});
        })
        .catch(() => {});
    },
    [frames, primitives, generate, prefetch],
  );

  const header = (
    <View className="flex-row items-center justify-between px-4 py-2">
      <Pressable onPress={goBack} className="py-1 pr-3 active:opacity-70">
        <Text className="text-sm text-muted-foreground">Path</Text>
      </Pressable>
      {ref ? (
        <Text className="text-xs text-muted-foreground">
          Lesson {ref.unit} · node {ref.node + 1}
        </Text>
      ) : null}
    </View>
  );

  if (!ref) {
    return (
      <CustomHeaderScreen>
        {header}
        <Centred>
          <Text className="text-base text-muted-foreground">That is not a node of the course.</Text>
        </Centred>
      </CustomHeaderScreen>
    );
  }

  if (!frames || !session) {
    return (
      <CustomHeaderScreen>
        {header}
        <Centred>
          <ActivityIndicator size="large" />
        </Centred>
      </CustomHeaderScreen>
    );
  }

  if (frames.length === 0) {
    return (
      <CustomHeaderScreen>
        {header}
        <Centred>
          <Text className="text-base text-muted-foreground">
            Lesson {ref.unit} has no node {ref.node + 1}.
          </Text>
        </Centred>
      </CustomHeaderScreen>
    );
  }

  const item = currentItem(session);
  const answered = sessionAnswered(session);
  const total = sessionTotal(session);

  return (
    <CustomHeaderScreen>
      <View className="flex-row items-center justify-between px-4 py-2">
        <Pressable onPress={goBack} className="py-1 pr-3 active:opacity-70">
          <Text className="text-sm text-muted-foreground">Path</Text>
        </Pressable>
        <Text className="text-xs text-muted-foreground">
          Lesson {ref.unit} · node {ref.node + 1}
          {total > 0 ? ` · ${Math.min(answered + 1, total)} of ${total}` : ""}
        </Text>
      </View>

      {(item?.step === "recognise" || item?.step === "identify") && !poolReady ? (
        <Centred>
          <ActivityIndicator size="large" />
        </Centred>
      ) : item?.step === "recognise" || item?.step === "identify" ? (
        <ChoiceStep
          // `misses` is in the key because a re-queued item is the same frame and
          // the same step: without it the drill keeps its answered state.
          key={`${item.step}:${item.frame.literal}:${session.misses}`}
          step={item.step}
          frame={item.frame}
          similar={similar.get(item.frame.literal) ?? []}
          unit={unitFrames}
          primitives={primitives.get(item.frame.literal) ?? []}
          onAnswered={(result) =>
            onAnswered(item.step as "recognise" | "identify", item.frame, result)
          }
          onDone={onSeen}
          onUnaskable={onUnaskable}
        />
      ) : item?.step === "meet" ? (
        <MeetStep
          key={item.frame.literal}
          frame={item.frame}
          primitives={primitives.get(item.frame.literal) ?? []}
          generation={generation}
          canGenerate={!!strokesDb}
          onGenerate={onGenerate}
          onDone={onDone}
        />
      ) : (
        <Centred>
          <Text className="text-xl font-semibold text-foreground">
            {total === 0 ? "Nothing to do here yet" : "Node met"}
          </Text>
          <Text className="mt-2 text-center text-sm text-muted-foreground">
            {total === 0
              ? "The drills for this pass land in a coming update."
              : `${session.cleared.length} of ${total} frames have a story.`}
          </Text>
          <Pressable
            onPress={goBack}
            className="mt-6 rounded-xl bg-primary px-5 py-3 active:opacity-80"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              Back to the path
            </Text>
          </Pressable>
        </Centred>
      )}
    </CustomHeaderScreen>
  );
}
