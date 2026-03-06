import React from "react";
import { View } from "react-native";
import { useAtomValue } from "jotai";
import { Text } from "@/components/ui/text";
import { showPitchAccentAtom, showPitchAccentTypeAtom } from "@/stores/settings";
import type { PitchAccent as PitchAccentType } from "@/db/types";

interface PitchAccentProps {
  accent: PitchAccentType;
  /** Font size of mora text — used to scale line thickness and drop height. Defaults to 14. */
  fontSize?: number;
  /** Color for pitch accent lines. Defaults to foreground. */
  lineColor?: string;
  /** Custom renderer for each mora's text. Receives (mora, moraIndex). */
  renderMora?: (mora: string, moraIndex: number) => React.ReactNode;
  /** Ignore global settings and always show lines + type. Used by the settings guide. */
  forceShow?: boolean;
}

const DEFAULT_FONT = 14;

/**
 * Renders pitch accent as a line diagram above kana.
 * Continuous line above text: high position = high pitch.
 * Vertical drops at pitch transitions. Trailing drop for odaka words.
 * All line dimensions scale proportionally with fontSize.
 */
export function PitchAccent({
  accent,
  fontSize = DEFAULT_FONT,
  lineColor,
  renderMora,
  forceShow,
}: PitchAccentProps) {
  const showLines = useAtomValue(showPitchAccentAtom);
  const showType = useAtomValue(showPitchAccentTypeAtom);
  const linesVisible = forceShow || showLines;
  const typeVisible = forceShow || showType;

  const { reading, pitchNumber } = accent;
  const morae = splitMorae(reading);

  const scale = fontSize / DEFAULT_FONT;
  const lineH = Math.max(1, scale);
  const dropH = Math.round(8 * scale);

  // Odaka: last mora is high and pitch drops after it (on particles).
  const lastHigh = morae.length > 0 && getMoraPitch(morae.length - 1, pitchNumber, morae.length);
  const isOdaka = pitchNumber > 0 && lastHigh;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      {morae.map((mora, i) => {
        const isHigh = getMoraPitch(i, pitchNumber, morae.length);
        const nextHigh =
          i < morae.length - 1 ? getMoraPitch(i + 1, pitchNumber, morae.length) : null;
        const drops = isHigh && nextHigh === false;
        const trailingDrop = i === morae.length - 1 && isOdaka;

        return (
          <View key={i} style={{ overflow: "visible" }}>
            {/* Line area — minimal height, drops overflow into text */}
            {linesVisible && (
              <View
                style={{
                  height: lineH,
                  marginBottom: -lineH,
                  flexDirection: "row",
                  overflow: "visible",
                }}
              >
                {/* Horizontal line — only render for high morae */}
                {isHigh && (
                  <View
                    className={lineColor ? undefined : "bg-foreground"}
                    style={{
                      flex: 1,
                      height: lineH,
                      ...(lineColor ? { backgroundColor: lineColor } : {}),
                    }}
                  />
                )}
                {/* Vertical drop between this mora and next */}
                {drops && (
                  <View
                    className={lineColor ? undefined : "bg-foreground"}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      height: dropH,
                      width: lineH,
                      ...(lineColor ? { backgroundColor: lineColor } : {}),
                    }}
                  />
                )}
                {/* Trailing drop for odaka */}
                {trailingDrop && (
                  <View
                    className={lineColor ? undefined : "bg-foreground"}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      height: dropH,
                      width: lineH,
                      ...(lineColor ? { backgroundColor: lineColor } : {}),
                    }}
                  />
                )}
              </View>
            )}
            {/* Mora text */}
            <View style={{ alignItems: "center" }}>
              {renderMora ? (
                renderMora(mora, i)
              ) : (
                <Text
                  style={
                    fontSize !== DEFAULT_FONT
                      ? { fontSize, lineHeight: Math.round(fontSize * 1.3) }
                      : undefined
                  }
                  className="text-sm text-foreground"
                >
                  {mora}
                </Text>
              )}
            </View>
          </View>
        );
      })}
      {typeVisible && (
        <View style={{ justifyContent: "flex-end" }}>
          <Text
            style={{ marginLeft: 2 * scale, fontSize: Math.min(Math.round(10 * scale), 16) }}
            className="text-muted-foreground"
          >
            [{pitchNumber}]
          </Text>
        </View>
      )}
    </View>
  );
}

export function getMoraPitch(index: number, downstep: number, _totalMorae: number): boolean {
  if (downstep === 0) {
    return index > 0;
  }
  if (downstep === 1) {
    return index === 0;
  }
  return index > 0 && index < downstep;
}

/** Split Japanese text into morae (treating digraphs like きょ as one mora) */
export function splitMorae(text: string): string[] {
  const smallKana = new Set([
    "ゃ",
    "ゅ",
    "ょ",
    "ぁ",
    "ぃ",
    "ぅ",
    "ぇ",
    "ぉ",
    "ャ",
    "ュ",
    "ョ",
    "ァ",
    "ィ",
    "ゥ",
    "ェ",
    "ォ",
  ]);
  const morae: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (i + 1 < text.length && smallKana.has(text[i + 1])) {
      morae.push(text[i] + text[i + 1]);
      i++;
    } else {
      morae.push(text[i]);
    }
  }
  return morae;
}
