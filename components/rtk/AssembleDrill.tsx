import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { PrimitiveGlyph } from "@/components/PrimitiveGlyph";
import { Text } from "@/components/ui/text";
import type { KanjiPrimitive } from "@/db/types";
import {
  buildBoard,
  canAssemble,
  judge,
  type AssemblePiece,
  type AssembleVerdict,
} from "@/lib/rtk-assemble";
import type { CourseFrame } from "@/lib/rtk-course";

interface Props {
  frame: CourseFrame;
  keyword: string | null;
  primitives: KanjiPrimitive[];
  /** Components of other frames, to pad the board out. */
  pool: readonly AssemblePiece[];
  onAnswer: (result: { correct: boolean; responseMs: number }) => void;
  onDone: () => void;
  /** Fewer than two identifiable components — nothing to assemble. */
  onUnaskable: () => void;
}

const DECOYS = 3;
const CORRECT_PAUSE_MS = 650;

function Tile({
  piece,
  order,
  state,
  onPress,
}: {
  piece: AssemblePiece;
  /** 1-based position in the taps so far, or null when untapped. */
  order: number | null;
  state: "idle" | "picked" | "wrong";
  onPress: () => void;
}) {
  const tone =
    state === "wrong"
      ? "border-destructive bg-destructive/10"
      : state === "picked"
        ? "border-primary bg-primary/10"
        : "border-border bg-secondary";
  return (
    <Pressable
      onPress={onPress}
      className={`min-w-[88px] items-center rounded-xl border px-3 py-2 active:opacity-80 ${tone}`}
    >
      <View className="flex-row items-center gap-1">
        <PrimitiveGlyph
          glyph={piece.glyph}
          displayGlyph={piece.displayGlyph}
          className="text-2xl text-foreground"
        />
        {order ? <Text className="text-xs text-muted-foreground">{order}</Text> : null}
      </View>
      <Text className="text-xs text-muted-foreground">{piece.keyword}</Text>
    </Pressable>
  );
}

/**
 * Tap a frame's components in writing order. This is the exercise no other app
 * has, and the one RTK is actually about: the frame IS its parts, in that order.
 */
export function AssembleDrill({
  frame,
  keyword,
  primitives,
  pool,
  onAnswer,
  onDone,
  onUnaskable,
}: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const sequence = useRef<string[]>([]);
  const settled = useRef(false);
  const askedAt = useRef(0);
  const moveOn = useRef<ReturnType<typeof setTimeout> | null>(null);

  const board = useMemo(
    () => buildBoard(primitives, pool, DECOYS, frame.index),
    [primitives, pool, frame.index],
  );

  useEffect(() => {
    askedAt.current = Date.now();
  }, [frame.literal]);

  useEffect(
    () => () => {
      if (moveOn.current) clearTimeout(moveOn.current);
    },
    [],
  );

  const askable = canAssemble(primitives);
  useEffect(() => {
    if (!askable) onUnaskable();
  }, [askable, onUnaskable]);

  const verdict: AssembleVerdict = judge(picked, board.answer);

  const tap = useCallback(
    (piece: AssemblePiece) => {
      if (settled.current) return;
      // The ref is the sequence; the state only draws it. Two taps in one batch
      // would both read the same `picked` and the first would be lost — scoring
      // a miss for a learner who tapped in the right order.
      const next = [...sequence.current, piece.target];
      sequence.current = next;
      setPicked(next);
      const outcome = judge(next, board.answer);
      if (outcome === "building") return;

      settled.current = true;
      onAnswer({
        correct: outcome === "done",
        responseMs: askedAt.current ? Date.now() - askedAt.current : 0,
      });
      if (outcome === "done") moveOn.current = setTimeout(onDone, CORRECT_PAUSE_MS);
    },
    [board.answer, onAnswer, onDone],
  );

  const shown = keyword ?? frame.keyword;

  return (
    <View className="flex-1 p-4">
      <Text className="text-center text-xs text-muted-foreground">
        Tap its parts, in writing order
      </Text>

      <View className="items-center py-5">
        <Text className="text-6xl text-foreground">{frame.literal}</Text>
        <Text className="mt-1 text-base font-semibold text-foreground">{shown}</Text>
      </View>

      <View className="flex-row flex-wrap justify-center gap-2">
        {board.tiles.map((piece) => {
          const at = picked.indexOf(piece.target);
          const isLastWrong = verdict === "wrong" && at === picked.length - 1;
          return (
            <Tile
              key={piece.target}
              piece={piece}
              order={at >= 0 ? at + 1 : null}
              state={isLastWrong ? "wrong" : at >= 0 ? "picked" : "idle"}
              onPress={() => tap(piece)}
            />
          );
        })}
      </View>

      {verdict === "wrong" ? (
        <View className="mt-6 rounded-xl border border-border p-3">
          <Text className="text-sm font-semibold text-foreground">In writing order:</Text>
          <View className="mt-2 flex-row flex-wrap items-center gap-2">
            {board.answer.map((piece, i) => (
              <View key={piece.target} className="flex-row items-center gap-1">
                <Text className="text-xs text-muted-foreground">{i + 1}</Text>
                <PrimitiveGlyph
                  glyph={piece.glyph}
                  displayGlyph={piece.displayGlyph}
                  className="text-xl text-foreground"
                />
                <Text className="text-xs text-muted-foreground">{piece.keyword}</Text>
              </View>
            ))}
          </View>
          <Pressable
            onPress={onDone}
            className="mt-3 items-center rounded-xl bg-primary px-4 py-2 active:opacity-80"
          >
            <Text className="text-sm font-semibold text-primary-foreground">Got it</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
