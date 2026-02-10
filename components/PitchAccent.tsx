import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import type { PitchAccent as PitchAccentType } from "@/db/types";

interface PitchAccentProps {
  accent: PitchAccentType;
}

/**
 * Renders pitch accent as a visual pattern.
 * 0 = heiban (flat: LHHH...)
 * 1 = atamadaka (HLLL...)
 * N = drops after Nth mora
 */
export function PitchAccent({ accent }: PitchAccentProps) {
  const { reading, pitchNumber } = accent;
  const morae = splitMorae(reading);

  return (
    <View className="flex-row items-end gap-0">
      {morae.map((mora, i) => {
        const isHigh = getMoraPitch(i, pitchNumber, morae.length);
        return (
          <View key={i} className="items-center">
            <View
              className={`h-1 w-full ${
                i > 0 ? getBridgeColor(i - 1, i, pitchNumber, morae.length) : ""
              }`}
            />
            <View className={isHigh ? "mb-2" : "mt-2"}>
              <Text className="text-sm text-foreground">{mora}</Text>
            </View>
          </View>
        );
      })}
      <Text className="ml-1 text-xs text-muted-foreground">[{pitchNumber}]</Text>
    </View>
  );
}

function getMoraPitch(index: number, downstep: number, _totalMorae: number): boolean {
  if (downstep === 0) {
    // Heiban: first mora low, rest high
    return index > 0;
  }
  if (downstep === 1) {
    // Atamadaka: first mora high, rest low
    return index === 0;
  }
  // Nakadaka/Odaka: first low, high until downstep, then low
  return index > 0 && index < downstep;
}

function getBridgeColor(
  prevIndex: number,
  _currIndex: number,
  downstep: number,
  totalMorae: number,
): string {
  const prevHigh = getMoraPitch(prevIndex, downstep, totalMorae);
  const currHigh = getMoraPitch(prevIndex + 1, downstep, totalMorae);
  if (prevHigh && currHigh) return "bg-primary";
  if (!prevHigh && !currHigh) return "bg-muted";
  return "bg-destructive";
}

/** Split Japanese text into morae (treating digraphs like きょ as one mora) */
function splitMorae(text: string): string[] {
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
