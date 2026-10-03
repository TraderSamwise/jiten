import React, { useCallback, useRef, useState } from "react";
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Text } from "@/components/ui/text";
import type { StrokePath } from "@/db/types";
import type { CourseFrame } from "@/lib/rtk-course";
import {
  gradeLabel,
  strokePath,
  STROKE_BOX,
  WRITE_GRADES,
  type Point,
  type WriteGrade,
} from "@/lib/rtk-write";

interface Props {
  frame: CourseFrame;
  keyword: string | null;
  /** The real strokes, revealed on demand. */
  strokes: StrokePath[];
  onAnswer: (result: { grade: WriteGrade; responseMs: number }) => void;
  onDone: () => void;
}

/**
 * Keyword to kanji, written with a finger. The grade is the learner's own: a
 * stroke-match against KanjiVG is a project of its own, and admitting you could
 * not write it is the exercise the book sets.
 */
export function WriteDrill({ frame, keyword, strokes, onAnswer, onDone }: Props) {
  const [drawn, setDrawn] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [revealed, setRevealed] = useState(false);
  const points = useRef<Point[]>([]);
  const side = useRef(0);
  const askedAt = useRef(0);
  const graded = useRef(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    side.current = e.nativeEvent.layout.width;
    if (!askedAt.current) askedAt.current = Date.now();
  }, []);

  /** Screen point to the 109-unit box the real strokes live in. */
  const at = (e: GestureResponderEvent): Point => {
    const scale = side.current ? STROKE_BOX / side.current : 1;
    return { x: e.nativeEvent.locationX * scale, y: e.nativeEvent.locationY * scale };
  };

  /** A second finger has no grant of its own and would extend the first stroke. */
  const oneFinger = (e: GestureResponderEvent) => (e.nativeEvent.touches?.length ?? 1) <= 1;

  const begin = (e: GestureResponderEvent) => {
    points.current = [at(e)];
    setCurrent(strokePath(points.current));
  };

  const extend = (e: GestureResponderEvent) => {
    if (!oneFinger(e)) return;
    points.current = [...points.current, at(e)];
    setCurrent(strokePath(points.current));
  };

  const end = () => {
    const path = strokePath(points.current);
    points.current = [];
    setCurrent("");
    if (path) setDrawn((previous) => [...previous, path]);
  };

  const grade = useCallback(
    (chosen: WriteGrade) => {
      if (graded.current) return;
      graded.current = true;
      const started = askedAt.current;
      onAnswer({ grade: chosen, responseMs: started ? Date.now() - started : 0 });
      onDone();
    },
    [onAnswer, onDone],
  );

  const shown = keyword ?? frame.keyword;

  return (
    <View className="flex-1 p-4">
      <Text className="text-center text-xs text-muted-foreground">Write it</Text>
      <Text className="mt-1 text-center text-2xl font-semibold text-foreground">{shown}</Text>

      <View
        onLayout={onLayout}
        onStartShouldSetResponder={() => !revealed}
        onMoveShouldSetResponder={() => !revealed}
        onResponderGrant={begin}
        onResponderMove={extend}
        onResponderRelease={end}
        onResponderTerminate={end}
        className="mt-4 aspect-square w-full rounded-2xl border border-border bg-secondary/40"
      >
        {/* The canvas is the responder; the drawing must not swallow a touch. */}
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${STROKE_BOX} ${STROKE_BOX}`}
          pointerEvents="none"
        >
          {revealed
            ? strokes.map((stroke, i) => (
                <Path
                  key={`real-${i}`}
                  d={stroke.d}
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))
            : null}
          {[...drawn, current].filter(Boolean).map((d, i) => (
            <Path
              key={`mine-${i}`}
              d={d}
              fill="none"
              stroke="#a1a1aa"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </View>

      <View className="mt-3 flex-row justify-between">
        <Pressable
          onPress={() => {
            setDrawn([]);
            setCurrent("");
          }}
          className="rounded-lg border border-border px-3 py-1.5 active:opacity-70"
        >
          <Text className="text-xs font-medium text-foreground">Clear</Text>
        </Pressable>
        <Pressable
          onPress={() => setRevealed(true)}
          className="rounded-lg border border-border px-3 py-1.5 active:opacity-70"
        >
          <Text className="text-xs font-medium text-foreground">
            {revealed ? `${frame.literal} · ${strokes.length} strokes` : "Show me"}
          </Text>
        </Pressable>
      </View>

      {revealed ? (
        <View className="mt-5 gap-2">
          <Text className="text-center text-sm text-muted-foreground">How did that go?</Text>
          <View className="flex-row gap-2">
            {WRITE_GRADES.map((option) => (
              <Pressable
                key={option}
                onPress={() => grade(option)}
                className={`flex-1 items-center rounded-xl px-3 py-3 active:opacity-80 ${
                  option === "got-it" ? "bg-primary" : "border border-border bg-secondary"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    option === "got-it" ? "text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {gradeLabel(option)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
