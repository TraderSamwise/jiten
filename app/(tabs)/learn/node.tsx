import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { AssembleDrill } from "@/components/rtk/AssembleDrill";
import { ChoiceDrill } from "@/components/rtk/ChoiceDrill";
import { ClozeDrill } from "@/components/rtk/ClozeDrill";
import { WriteDrill } from "@/components/rtk/WriteDrill";
import { MeetFrame } from "@/components/rtk/MeetFrame";
import { Text } from "@/components/ui/text";
import { CustomHeaderScreen } from "@/components/CustomHeaderScreen";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { useSync } from "@/db/sync-provider";
import {
  getPrimitivesForKanjiAsync,
  getStrokePathsAsync,
  getSynonymsForKeywordAsync,
} from "@/db/kanji-search";
import { getUserDrizzle } from "@/db/drizzle";
import {
  loadDecoyPieces,
  loadNodeFrames,
  loadSimilarPathFrames,
  loadUnitFrames,
} from "@/db/rtk-frames";
import { awardCrown, getNodeProgress, markNodeSeen } from "@/db/rtk-progress";
import type { KanjiPrimitive, StrokePath } from "@/db/types";
import { useKanjiMnemonic } from "@/hooks/useKanjiMnemonic";
import { useGlyphOrigin } from "@/hooks/useGlyphOrigin";
import { useMnemonicGeneration, type GenerationState } from "@/hooks/useMnemonicGeneration";
import { useSafeGoBack } from "@/lib/navigation";
import { logPracticeEvent, recordConfusion } from "@/lib/practice-logger";
import {
  CROWN_MAX,
  nextCrown,
  nodeId,
  nodeRefFromParams,
  type CourseFrame,
} from "@/lib/rtk-course";
import type { AssemblePiece } from "@/lib/rtk-assemble";
import { mnemonicRequestFor } from "@/lib/rtk-prompt";
import { graduateFrames } from "@/lib/rtk-graduate";
import { gradeOutcome, type WriteGrade } from "@/lib/rtk-write";
import {
  advance,
  currentItem,
  dropStep,
  isComplete,
  skipCurrent,
  startSession,
  type SessionState,
} from "@/lib/rtk-session";

const pieceCache = new WeakMap<object, AssemblePiece[]>();

async function decoyPieces(strokesDb: Parameters<typeof loadDecoyPieces>[0]) {
  const cached = pieceCache.get(strokesDb);
  if (cached) return cached;
  const loaded = await loadDecoyPieces(strokesDb);
  pieceCache.set(strokesDb, loaded);
  return loaded;
}

/** Both choice drills ask about the same frame; the mode separates the history. */
const CHOICE_MODE = {
  recognise: "rtk_recognise",
  identify: "rtk_identify",
} as const;

/** An order mistake, not a mistaken lookalike — so no confusion pair. */
const ASSEMBLE_MODE = "rtk_assemble";
const WRITE_MODE = "rtk_write";
const CLOZE_MODE = "rtk_cloze";

function Centred({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center p-6">{children}</View>;
}

/** A step the data cannot support: hand it back rather than show a spinner. */
function SkipStep({ onSkip }: { onSkip: () => void }) {
  useEffect(() => {
    onSkip();
  }, [onSkip]);
  return (
    <Centred>
      <ActivityIndicator />
    </Centred>
  );
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
  const { mnemonic, keyword, loaded, saveMnemonic, saveKeywordOnly } = useKanjiMnemonic(
    frame.literal,
  );
  // Saving is an async write; two taps would advance the queue twice and the
  // next frame would be marked answered without ever being shown.
  const saving = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const glyphOrigin = useGlyphOrigin(frame.literal);

  return (
    <MeetFrame
      saveError={saveError}
      frame={frame}
      primitives={primitives}
      keyword={keyword}
      glyphOrigin={glyphOrigin}
      story={mnemonic}
      generation={generation}
      canGenerate={canGenerate}
      onGenerate={(fresh) => onGenerate(frame, keyword, fresh)}
      onSave={(text) => {
        if (saving.current) return;
        saving.current = true;
        setSaveError(null);
        saveMnemonic(text)
          .then(() => onDone("saved"))
          .catch((err) => {
            // Not `finally`: a write that failed must not advance the queue and
            // report the frame as met, with the learner's text gone.
            console.warn("[learn] could not save the story", err);
            saving.current = false;
            setSaveError("That did not save. Try again.");
          });
      }}
      onKeyword={(text) => {
        if (!loaded) return;
        // A keyword equal to Heisig's is no override, so it is stored as none —
        // the same rule KanjiDetail applies. Written on its own: the whole-row
        // write would carry a story this screen may never have read.
        const own = text.trim() === frame.keyword ? "" : text;
        saveKeywordOnly(own).catch((err) =>
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

function AssembleStep({
  frame,
  primitives,
  pool,
  onAnswered,
  onDone,
  onUnaskable,
}: {
  frame: CourseFrame;
  primitives: KanjiPrimitive[];
  pool: readonly AssemblePiece[];
  onAnswered: (result: { correct: boolean; responseMs: number }) => void;
  onDone: () => void;
  onUnaskable: () => void;
}) {
  const { keyword } = useKanjiMnemonic(frame.literal);

  return (
    <AssembleDrill
      frame={frame}
      keyword={keyword}
      primitives={primitives}
      pool={pool}
      onAnswer={onAnswered}
      onDone={onDone}
      onUnaskable={onUnaskable}
    />
  );
}

function WriteStep({
  frame,
  strokes,
  onGraded,
  onDone,
}: {
  frame: CourseFrame;
  strokes: StrokePath[];
  onGraded: (result: { grade: WriteGrade; responseMs: number }) => void;
  onDone: () => void;
}) {
  const { keyword } = useKanjiMnemonic(frame.literal);

  return (
    <WriteDrill
      frame={frame}
      keyword={keyword}
      strokes={strokes}
      onAnswer={onGraded}
      onDone={onDone}
    />
  );
}

function ClozeStep({
  frame,
  primitives,
  onAnswered,
  onDone,
  onUnaskable,
}: {
  frame: CourseFrame;
  primitives: KanjiPrimitive[];
  onAnswered: (result: { correct: boolean; typed: string; responseMs: number }) => void;
  onDone: () => void;
  onUnaskable: () => void;
}) {
  const { strokesDb } = useDatabase();
  const { mnemonic, keyword, loaded } = useKanjiMnemonic(frame.literal);
  const [synonyms, setSynonyms] = useState<string[]>([]);
  const shown = keyword ?? frame.keyword;

  useEffect(() => {
    if (!strokesDb || !shown) return;
    let current = true;
    getSynonymsForKeywordAsync(strokesDb, shown)
      .then((loaded) => {
        if (current) setSynonyms(loaded);
      })
      .catch(() => {
        if (current) setSynonyms([]);
      });
    return () => {
      current = false;
    };
  }, [strokesDb, shown]);

  // Until the note is read, `mnemonic` is null because nothing has been read —
  // and the drill would decide it has no story to cloze and skip itself.
  if (!loaded) {
    return (
      <Centred>
        <ActivityIndicator size="large" />
      </Centred>
    );
  }

  return (
    <ClozeDrill
      frame={frame}
      keyword={keyword}
      story={mnemonic}
      primitives={primitives}
      synonyms={synonyms}
      onAnswer={onAnswered}
      onDone={onDone}
      onUnaskable={onUnaskable}
    />
  );
}

export default function LearnNodeScreen() {
  const { unit, node } = useLocalSearchParams<{ unit?: string; node?: string }>();
  const { dictDb, strokesDb, backgroundStatus } = useDatabase();
  const userDb = useUserDb();
  const goBack = useSafeGoBack("/learn/rtk");
  // The strokes tier opens in the background, and the primitives come with it.
  // Generation does not need them — the server has the glyph origin and the
  // crowd's hook — but it is worth the wait while they are actually coming.
  const strokesState = backgroundStatus.find((item) => item.key === "strokes")?.state;
  const strokesArriving =
    !strokesDb &&
    (strokesState === "pending" || strokesState === "downloading" || strokesState === "importing");
  const { markDirty } = useSync();
  // Held by the runner, not the step: the story cache and the node-ahead
  // prefetch have to outlive the frame that asked for the first story.
  const { state: generation, generate } = useMnemonicGeneration();

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
  const [crown, setCrown] = useState(0);
  // The ref guards against a second award; the state is what the screen reads,
  // because a ref change does not re-render.
  // Keyed to the node, because the loader effect runs first in the same flush
  // and a boolean reset there let a stale session award — and then blocked the
  // real pass from ever awarding.
  const awardedFor = useRef<string | null>(null);
  const [crowned, setCrowned] = useState<string | null>(null);
  const [pieces, setPieces] = useState<AssemblePiece[] | null>(null);
  const [strokes, setStrokes] = useState<Map<string, StrokePath[]>>(new Map());
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

    setPrimitives(new Map());
    setSimilar(new Map());
    setStrokes(new Map());
    Promise.all([loadNodeFrames(dictDb, ref), getNodeProgress(userDb, ref)])
      .then(([loaded, progress]) => {
        if (!current) return;
        setFrames(loaded);
        setCrown(progress?.crown ?? 0);
        setSession(startSession(loaded, progress?.crown ?? 0));
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
    Promise.all(
      frames.map(async (frame) => {
        try {
          return [frame.literal, await getStrokePathsAsync(strokesDb, frame.literal)] as const;
        } catch {
          return [frame.literal, [] as StrokePath[]] as const;
        }
      }),
    ).then((pairs) => {
      if (current) setStrokes(new Map(pairs));
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

  // The strokes tier is a download, and may never arrive. Without it there are
  // no components to tap, so the step leaves the pass instead of spinning.
  const everHadStrokes = useRef(false);
  useEffect(() => {
    if (strokesDb) everHadStrokes.current = true;
  }, [strokesDb]);
  useEffect(() => {
    // Only when the tier has never been there. On web a cross-tab lock release
    // nulls the handle for a moment, and that must not cost the sitting its
    // stroke steps.
    if (strokesDb || everHadStrokes.current || !session) return;
    setSession((current) => {
      if (!current) return current;
      return dropStep(dropStep(current, "assemble"), "write");
    });
  }, [strokesDb, session]);

  // Every identifiable component, once, as the assemble drill's decoys. The 868
  // rows never change, so the read is paid once per database rather than per node.
  useEffect(() => {
    if (!strokesDb) return;
    let current = true;
    decoyPieces(strokesDb)
      .then((loaded) => {
        if (current) setPieces(loaded);
      })
      .catch(() => {
        if (current) setPieces([]);
      });
    return () => {
      current = false;
    };
  }, [strokesDb]);

  /**
   * The crown, and the cards. Only once something was actually answered — a
   * pass whose every step was skipped has tested nothing — and only once, which
   * the ref guards against a re-render.
   */
  useEffect(() => {
    if (!ref || !userDb || !session) return;
    const id = nodeId(ref);
    if (awardedFor.current === id) return;
    if (!isComplete(session) || session.cleared.length === 0) return;
    awardedFor.current = id;
    setCrowned(id);
    const next = nextCrown(crown);
    awardCrown(userDb, ref, next).catch((err) =>
      console.warn("[learn] could not award the crown", err),
    );
    if (drizzleDb && frames?.length) {
      // Idempotent: a frame carded at crown 1 is not carded again at 2 or 3.
      graduateFrames(drizzleDb, frames, ref.unit).catch((err) =>
        console.warn("[learn] could not make the cards", err),
      );
    }
  }, [ref, userDb, drizzleDb, session, crown, frames]);

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

  const onAssembled = useCallback(
    (frame: CourseFrame, result: { correct: boolean; responseMs: number }) => {
      lastResult.current = result.correct;
      if (!drizzleDb) return;
      logPracticeEvent(drizzleDb, {
        entryId: 0,
        kanjiLiteral: frame.literal,
        practiceMode: ASSEMBLE_MODE,
        correct: result.correct,
        responseMs: result.responseMs,
        sessionId: sessionTag.current || null,
      }).catch(() => {});
      markDirty();
    },
    [drizzleDb, markDirty],
  );

  const onGraded = useCallback(
    (frame: CourseFrame, result: { grade: WriteGrade; responseMs: number }) => {
      const correct = gradeOutcome(result.grade) === "hit";
      lastResult.current = correct;
      if (!drizzleDb) return;
      logPracticeEvent(drizzleDb, {
        entryId: 0,
        kanjiLiteral: frame.literal,
        practiceMode: WRITE_MODE,
        correct,
        responseMs: result.responseMs,
        // The learner's own verdict, which is the only grade this drill has.
        typedAnswer: result.grade,
        sessionId: sessionTag.current || null,
      }).catch(() => {});
      markDirty();
    },
    [drizzleDb, markDirty],
  );

  const onClozed = useCallback(
    (frame: CourseFrame, result: { correct: boolean; typed: string; responseMs: number }) => {
      lastResult.current = result.correct;
      if (!drizzleDb) return;
      logPracticeEvent(drizzleDb, {
        entryId: 0,
        kanjiLiteral: frame.literal,
        practiceMode: CLOZE_MODE,
        correct: result.correct,
        responseMs: result.responseMs,
        typedAnswer: result.typed,
        sessionId: sessionTag.current || null,
      }).catch(() => {});
      markDirty();
    },
    [drizzleDb, markDirty],
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
      generate(request, { fresh }).catch(() => {});
    },
    [primitives, generate],
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
  // Skipped steps leave the count: a node that drops its stroke drills should
  // read "1 of 10", not "6 of 10" before a question has been answered.
  const answered = session.cleared.length;
  const total = answered + session.queue.length;

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

      {item?.step === "cloze" ? (
        <ClozeStep
          key={`cloze:${item.frame.literal}:${session.misses}`}
          frame={item.frame}
          primitives={primitives.get(item.frame.literal) ?? []}
          onAnswered={(result) => onClozed(item.frame, result)}
          onDone={onSeen}
          onUnaskable={onUnaskable}
        />
      ) : item?.step === "write" && !strokes.has(item.frame.literal) ? (
        strokesDb ? (
          <Centred>
            <ActivityIndicator size="large" />
          </Centred>
        ) : (
          // The handle went away mid-session, so nothing is coming: hand the
          // step back rather than spin on a read that will never land.
          <SkipStep key={`skip:write:${item.frame.literal}`} onSkip={onUnaskable} />
        )
      ) : item?.step === "write" && !strokes.get(item.frame.literal)?.length ? (
        // Nothing to reveal, so nothing to grade against.
        <SkipStep key={`skip:write:${item.frame.literal}`} onSkip={onUnaskable} />
      ) : item?.step === "write" ? (
        <WriteStep
          key={`write:${item.frame.literal}:${session.misses}`}
          frame={item.frame}
          strokes={strokes.get(item.frame.literal) ?? []}
          onGraded={(result) => onGraded(item.frame, result)}
          onDone={onSeen}
        />
      ) : item?.step === "assemble" && (!pieces || !primitives.has(item.frame.literal)) ? (
        strokesDb ? (
          <Centred>
            <ActivityIndicator size="large" />
          </Centred>
        ) : (
          <SkipStep key={`skip:assemble:${item.frame.literal}`} onSkip={onUnaskable} />
        )
      ) : item?.step === "assemble" ? (
        <AssembleStep
          key={`assemble:${item.frame.literal}:${session.misses}`}
          frame={item.frame}
          primitives={primitives.get(item.frame.literal) ?? []}
          pool={pieces ?? []}
          onAnswered={(result) => onAssembled(item.frame, result)}
          onDone={onSeen}
          onUnaskable={onUnaskable}
        />
      ) : (item?.step === "recognise" || item?.step === "identify") && !poolReady ? (
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
          canGenerate={!strokesArriving}
          onGenerate={onGenerate}
          onDone={onDone}
        />
      ) : (
        <Centred>
          <Text className="text-xl font-semibold text-foreground">
            {crown >= CROWN_MAX
              ? "Already crowned"
              : total === 0
                ? "Nothing to do here yet"
                : crowned === nodeId(ref)
                  ? "Crowned"
                  : "Node met"}
          </Text>
          <Text className="mt-2 text-center text-sm text-muted-foreground">
            {crown >= CROWN_MAX
              ? "This node is drilled to production. Nothing left to ask."
              : total === 0
                ? "There was nothing this pass could ask without the stroke data."
                : `${session.cleared.length} of ${total} answered.`}
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
