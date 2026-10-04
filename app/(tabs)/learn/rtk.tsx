import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect, useRouter } from "expo-router";
import { useAtomValue } from "jotai";

import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useUserDb } from "@/db/user-provider";
import { useRtkPath } from "@/hooks/useRtkPath";
import {
  ensureRtkReviewList,
  nextCardLine,
  RTK_REVIEW_LIST_ID,
  rtkReviewCounts,
  type RtkReviewCounts,
} from "@/lib/rtk-review";
import { dayResetHourAtom } from "@/stores/settings";
import {
  CROWN_MAX,
  formatFrameRange,
  isContiguousSpan,
  nodeFrameRange,
  RTK_PATH_FRAME_COUNT,
  type PathSummary,
  type UnitRow,
} from "@/lib/rtk-course";

type Mode = "learn" | "review";

/** Tiles past this many are behind "show all", so one lesson cannot be 29 rows. */
const TILES_SHOWN = 8;

/**
 * One node. It names the frames it asks about and says its crown in words:
 * a tint cannot carry that — `bg-primary/15` on a card is 1.4:1, which is not
 * a state indicator — so the tint is decoration and the words are the state.
 */
function NodeTile({
  label,
  crown,
  opening,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  crown: number;
  /** This is the node being opened: say so, rather than looking unresponsive. */
  opening: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const done = crown >= CROWN_MAX;
  const started = crown > 0 && !done;
  const skin = done
    ? "bg-primary border border-primary"
    : started
      ? "bg-transparent border-2 border-primary"
      : "bg-secondary/60 border border-muted-foreground";
  const ink = done ? "text-primary-foreground" : "text-foreground";

  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: opening, disabled: opening }}
      className={`min-h-[56px] min-w-[76px] items-center justify-center rounded-xl px-3 py-2 active:opacity-80 ${skin} ${
        opening ? "opacity-70" : ""
      }`}
    >
      <Text className={`text-xs font-semibold ${ink}`}>{label}</Text>
      {opening ? (
        // The label stays: swapping it for the spinner shrank the tile back to
        // its floor and reflowed the whole row mid-tap.
        <ActivityIndicator size="small" color={done ? "#71717a" : undefined} />
      ) : (
        <Text className={`mt-0.5 text-[10px] ${done ? "text-primary-foreground/80" : ink}`}>
          {done ? "done" : started ? `crown ${crown}` : "new"}
        </Text>
      )}
    </Pressable>
  );
}

/** The course introduces a frame; FSRS keeps it. One screen, two jobs. */
function ReviewPane({
  onGoToLearn,
  unavailable,
}: {
  onGoToLearn: () => void;
  /** No dictionary, so Learn cannot help them either. */
  unavailable: boolean;
}) {
  const userDb = useUserDb();
  const router = useRouter();
  const dayResetHour = useAtomValue(dayResetHourAtom);
  const [counts, setCounts] = useState<RtkReviewCounts | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      if (!userDb) return;
      rtkReviewCounts(userDb, dayResetHour)
        .then((next) => {
          if (current) setCounts(next);
        })
        .catch((err) => {
          console.warn("[learn] could not count the course's due cards", err);
          if (current) setError("Could not count what is due.");
        });
      return () => {
        current = false;
      };
    }, [userDb, dayResetHour]),
  );

  // The settings row has to exist before the engine opens: it bails without
  // one, and the learner would sit on a spinner that never resolves.
  const start = async () => {
    if (!userDb || starting) return;
    setStarting(true);
    setError(null);
    try {
      await ensureRtkReviewList(userDb);
      router.push(`/learn/study?listId=${RTK_REVIEW_LIST_ID}` as never);
    } catch (err) {
      console.warn("[learn] could not open the course review", err);
      setError("Could not open the review.");
    } finally {
      setStarting(false);
    }
  };

  if (!counts) {
    return (
      <View className="items-center py-10">
        {error ? <Text className="text-sm text-destructive">{error}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  // Keyed on whether anything is carded at all, not on whether anything is due
  // today: a course whose cards are all scheduled for next week is not a course
  // with nothing in it.
  // All three, not just the carded count: a vocabulary word added to a lesson
  // list is not a frame, so `scheduled` can be 0 while the queue has work.
  if (counts.scheduled === 0 && counts.due === 0 && counts.unseen === 0) {
    return (
      <View className="mt-4">
        <Card className="p-4">
          <Text className="text-base font-semibold text-foreground">Nothing to review yet</Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            {unavailable
              ? "The course needs the dictionary to be downloaded."
              : "A node becomes flashcards when you crown it. Earn a crown in Learn and its five frames arrive here."}
          </Text>
          {unavailable ? null : (
            <Pressable
              onPress={onGoToLearn}
              className="mt-3 items-center rounded-xl bg-primary px-4 py-2 active:opacity-80"
            >
              <Text className="text-sm font-semibold text-primary-foreground">Go to Learn</Text>
            </Pressable>
          )}
        </Card>
      </View>
    );
  }

  const nothingToDo = counts.due === 0 && counts.unseen === 0;

  return (
    <View className="mt-4">
      <Card className="p-4">
        <Text className="text-base font-semibold text-foreground">
          {counts.due > 0 ? `${counts.due} due` : "Nothing due today"}
        </Text>
        <Text className="mt-1 text-sm text-muted-foreground">
          {counts.unseen > 0
            ? `${counts.unseen} crowned frame${counts.unseen === 1 ? "" : "s"} waiting to be scheduled`
            : nextCardLine(counts.nextDueAt, counts.dueThrough)}
        </Text>
        <Text className="mt-2 text-xs text-muted-foreground">
          {Math.min(counts.scheduled, RTK_PATH_FRAME_COUNT)} of {RTK_PATH_FRAME_COUNT} frames carded
          · asked as Heisig asks, the keyword then the character
        </Text>
      </Card>

      <Pressable
        onPress={start}
        disabled={starting}
        className={`mt-3 items-center rounded-xl px-4 py-3 active:opacity-80 ${
          nothingToDo ? "border border-border bg-secondary" : "bg-primary"
        } ${starting ? "opacity-60" : ""}`}
      >
        <Text
          className={`text-base font-semibold ${
            nothingToDo ? "text-foreground" : "text-primary-foreground"
          }`}
        >
          {starting ? "Opening…" : nothingToDo ? "Review ahead" : "Review"}
        </Text>
      </Pressable>

      {error ? <Text className="mt-3 text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}

/** The path's own header: where you are, and the one tap that continues. */
function LearnHeader({
  unavailable,
  summary,
  opening,
  openNode,
}: {
  unavailable: boolean;
  summary: PathSummary | null;
  opening: string | null;
  openNode: (unit: number, node: number) => void;
}) {
  // A missing dictionary is not a slow one: say so rather than spin forever.
  if (unavailable) {
    return (
      <View className="items-center py-10">
        <Text className="text-base text-muted-foreground">
          The course needs the dictionary to be downloaded.
        </Text>
      </View>
    );
  }

  if (!summary) {
    return (
      <View className="items-center py-10">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const { next, rows: units } = summary;

  return (
    <View>
      <Text className="text-sm text-muted-foreground">
        {summary.earned} of {summary.possible} crowns · {units.length} lessons
      </Text>

      {next ? (
        <Pressable
          onPress={() => openNode(next.unit, next.node)}
          className="mt-4 items-center rounded-xl bg-primary px-4 py-3 active:opacity-80"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            {opening ? "Opening…" : "Continue"}
          </Text>
          <Text className="text-xs text-primary-foreground/80">
            Lesson {next.unit} · node {next.node + 1}
          </Text>
        </Pressable>
      ) : (
        <Card className="mt-4 p-4">
          <Text className="text-base font-semibold text-foreground">Every frame is crowned</Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            All 2,200 frames of volume 1, drilled to production.
          </Text>
        </Card>
      )}
    </View>
  );
}

/** A lesson and its nodes. Capped, because lesson 23 holds 29 of them. */
function LessonCard({
  row,
  opening,
  expanded,
  onToggle,
  openNode,
}: {
  row: UnitRow;
  opening: string | null;
  expanded: boolean;
  onToggle: () => void;
  openNode: (unit: number, node: number) => void;
}) {
  // Same honesty as the tiles: a lesson whose frames are not one unbroken run
  // gets no span rather than a made-up one.
  const span = isContiguousSpan(row)
    ? formatFrameRange({ from: row.firstFrame, to: row.lastFrame })
    : null;
  const shown = expanded ? row.crowns.length : Math.min(row.crowns.length, TILES_SHOWN);
  const hidden = row.crowns.length - shown;

  return (
    <Card className="mt-3 p-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-sm font-semibold text-foreground">Lesson {row.unit}</Text>
          {span ? <Text className="text-xs text-muted-foreground">frames {span}</Text> : null}
        </View>
        <Text className="text-xs text-muted-foreground">
          {row.earned}/{row.possible}
        </Text>
      </View>

      {row.crowns.length === 0 ? null : (
        <View className="mt-2 flex-row flex-wrap gap-2">
          {row.crowns.slice(0, shown).map((crown, node) => {
            const range = nodeFrameRange(row, node);
            // A dictionary whose frames are not one run gets a usable label
            // rather than a wrong one.
            const label = formatFrameRange(range) ?? `node ${node + 1}`;
            const state =
              crown >= CROWN_MAX
                ? "done"
                : crown > 0
                  ? `crown ${crown} of ${CROWN_MAX}`
                  : "not started";
            return (
              <NodeTile
                key={node}
                label={label}
                crown={crown}
                opening={opening === `${row.unit}:${node}`}
                accessibilityLabel={
                  range
                    ? `Frames ${range.from} to ${range.to}, ${state}`
                    : `Node ${node + 1}, ${state}`
                }
                onPress={() => openNode(row.unit, node)}
              />
            );
          })}

          {expanded && row.crowns.length > TILES_SHOWN ? (
            <Pressable
              onPress={onToggle}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Show fewer nodes of lesson ${row.unit}`}
              className="min-h-[56px] min-w-[76px] items-center justify-center rounded-xl border border-dashed border-muted-foreground px-3 py-2 active:opacity-80"
            >
              <Text className="text-xs font-semibold text-foreground">Show</Text>
              <Text className="mt-0.5 text-[10px] text-foreground">less</Text>
            </Pressable>
          ) : null}

          {hidden > 0 ? (
            <Pressable
              onPress={onToggle}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Show the remaining ${hidden} nodes of lesson ${row.unit}`}
              className="min-h-[56px] min-w-[76px] items-center justify-center rounded-xl border border-dashed border-muted-foreground px-3 py-2 active:opacity-80"
            >
              <Text className="text-xs font-semibold text-foreground">+{hidden}</Text>
              <Text className="mt-0.5 text-[10px] text-foreground">more</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Card>
  );
}

export default function RtkScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("learn");
  // Mounting the node screen is not instant, and a tile that does nothing
  // visible for a beat reads as a dropped tap. Cleared on focus, which is where
  // the learner lands when they come back.
  const [opening, setOpening] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(useCallback(() => setOpening(null), []));
  // Loaded once for the whole screen: the header needs the totals and the list
  // needs the rows, and two hooks meant two course-progress reads per focus.
  const { summary, unavailable } = useRtkPath();

  // Cast because expo-router's generated route union (.expo/types) only learns
  // about /learn once a dev server has regenerated it.
  const toggleExpanded = useCallback((unit: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(unit)) next.add(unit);
      return next;
    });
  }, []);

  const openNode = useCallback(
    (unit: number, node: number) => {
      const key = `${unit}:${node}`;
      // One at a time: the spinner says a push is under way, and a second tap
      // would push the same screen twice.
      if (opening) return;
      setOpening(key);
      router.push(`/learn/node?unit=${unit}&node=${node}` as never);
      // router.push resolves nothing and the focus effect cannot fire if the
      // screen never blurred, so a push that goes nowhere would leave a tile
      // spinning for good. Cleared by key, so a later tap's spinner survives
      // an earlier tap's timer.
      if (openTimer.current) clearTimeout(openTimer.current);
      openTimer.current = setTimeout(
        () => setOpening((current) => (current === key ? null : current)),
        4000,
      );
    },
    [opening, router],
  );

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );

  // The lesson cards are the list's own data, so they recycle; Review has none.
  const units = mode === "learn" && summary ? summary.rows : [];

  return (
    <FlashList
      data={units}
      extraData={expanded}
      keyExtractor={(row) => String(row.unit)}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      ListHeaderComponent={
        <View>
          <SegmentedControl
            fullWidth
            value={mode}
            onChange={setMode}
            options={[
              { value: "learn" as Mode, label: "Learn" },
              { value: "review" as Mode, label: "Review" },
            ]}
          />
          <View className="mt-4">
            {mode === "learn" ? (
              <LearnHeader
                unavailable={unavailable}
                summary={summary}
                opening={opening}
                openNode={openNode}
              />
            ) : (
              <ReviewPane onGoToLearn={() => setMode("learn")} unavailable={unavailable} />
            )}
          </View>
        </View>
      }
      renderItem={({ item: row }) => (
        <LessonCard
          row={row}
          opening={opening}
          expanded={expanded.has(row.unit)}
          onToggle={() => toggleExpanded(row.unit)}
          openNode={openNode}
        />
      )}
    />
  );
}
