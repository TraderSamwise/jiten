import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { WordFilterMode } from "@/hooks/useWordFilter";

interface GameSelectScreenProps {
  title: string;
  subtitle?: string;
  wordFilter: {
    reviewCount: number;
    learnCount: number;
    allCount: number;
  };
  selectedFilter: WordFilterMode;
  onFilterChange: (filter: WordFilterMode) => void;
  onStart: () => void;
  disabled?: boolean;
  minEntries?: number;
  children?: React.ReactNode;
}

export function GameSelectScreen({
  title,
  subtitle,
  wordFilter,
  selectedFilter,
  onFilterChange,
  onStart,
  disabled,
  minEntries = 1,
  children,
}: GameSelectScreenProps) {
  const filteredCount =
    selectedFilter === "review"
      ? wordFilter.reviewCount
      : selectedFilter === "learn"
        ? wordFilter.learnCount
        : wordFilter.allCount;

  const notEnough = filteredCount < minEntries;

  return (
    <View className="flex-1 justify-center px-6">
      <Text
        className={`text-xl font-bold text-foreground text-center ${subtitle ? "mb-2" : "mb-6"}`}
      >
        {title}
      </Text>
      {subtitle && (
        <Text className="text-sm text-muted-foreground text-center mb-6">{subtitle}</Text>
      )}

      <Text className="text-base font-semibold text-foreground mb-3">Words</Text>
      <SegmentedControl
        options={[
          { value: "review" as WordFilterMode, label: `Review (${wordFilter.reviewCount})` },
          { value: "learn" as WordFilterMode, label: `Learn (${wordFilter.learnCount})` },
          { value: "all" as WordFilterMode, label: `All (${wordFilter.allCount})` },
        ]}
        value={selectedFilter}
        onChange={onFilterChange}
        fullWidth
        className="mb-6"
      />

      {notEnough && (
        <Text className="text-sm text-red-400 text-center mb-4">
          Need at least {minEntries} {minEntries === 1 ? "entry" : "entries"} to play
        </Text>
      )}

      {children}

      <Button label="Start" onPress={onStart} disabled={disabled || notEnough} />
    </View>
  );
}
