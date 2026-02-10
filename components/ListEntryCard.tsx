import React from "react";
import { useRouter } from "expo-router";
import { PressableCard } from "@/components/ui/card";
import { EntrySummary } from "@/components/EntrySummary";
import type { DictEntry } from "@/db/types";

interface ListEntryCardProps {
  entry: DictEntry;
}

export function ListEntryCard({ entry }: ListEntryCardProps) {
  const router = useRouter();

  return (
    <PressableCard className="mb-1 p-3" onPress={() => router.push(`/lists/word/${entry.id}`)}>
      <EntrySummary entry={entry} variant="compact" />
    </PressableCard>
  );
}
