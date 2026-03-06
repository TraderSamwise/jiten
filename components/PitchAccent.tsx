import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import type { PitchAccent as PitchAccentType } from "@/db/types";

interface PitchAccentProps {
  accent: PitchAccentType;
  /** Custom renderer for each mora's text. Receives (mora, moraIndex). */
  renderMora?: (mora: string, moraIndex: number) => React.ReactNode;
}

const LINE_H = 1.5;
const STEP = 8;

/**
 * Renders pitch accent as a line diagram above kana.
 * Continuous line above text: high position = high pitch, low = low pitch.
 * Vertical risers at pitch transitions. Trailing drop for odaka words.
 */
export function PitchAccent({ accent, renderMora }: PitchAccentProps) {
  const { reading, pitchNumber } = accent;
  const morae = splitMorae(reading);

  // Odaka: last mora is high and pitch drops after it (on particles).
  const lastHigh = morae.length > 0 && getMoraPitch(morae.length - 1, pitchNumber, morae.length);
  const isOdaka = pitchNumber > 0 && lastHigh;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      {morae.map((mora, i) => {
        const isHigh = getMoraPitch(i, pitchNumber, morae.length);
        const nextHigh =
          i < morae.length - 1 ? getMoraPitch(i + 1, pitchNumber, morae.length) : null;
        const top = isHigh ? 0 : STEP;
        const risesOrDrops = nextHigh !== null && nextHigh !== isHigh;
        // For the last mora of an odaka word, show a trailing drop
        const trailingDrop = i === morae.length - 1 && isOdaka;

        return (
          <View key={i}>
            {/* Line area */}
            <View style={{ height: STEP + LINE_H, flexDirection: "row" }}>
              {/* Horizontal line */}
              <View className="bg-foreground" style={{ flex: 1, height: LINE_H, marginTop: top }} />
              {/* Vertical riser between this mora and next */}
              {risesOrDrops && (
                <View
                  className="bg-foreground"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: Math.min(top, nextHigh ? 0 : STEP),
                    height: STEP + LINE_H,
                    width: LINE_H,
                  }}
                />
              )}
              {/* Trailing drop for odaka: vertical line down from right edge */}
              {trailingDrop && (
                <View
                  className="bg-foreground"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    height: STEP + LINE_H,
                    width: LINE_H,
                  }}
                />
              )}
            </View>
            {/* Mora text */}
            <View style={{ alignItems: "center" }}>
              {renderMora ? (
                renderMora(mora, i)
              ) : (
                <Text className="text-sm text-foreground">{mora}</Text>
              )}
            </View>
          </View>
        );
      })}
      <Text className="ml-1 text-xs text-muted-foreground">[{pitchNumber}]</Text>
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
