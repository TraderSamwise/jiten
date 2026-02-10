import React from "react";
import { useRouter } from "expo-router";
import { PressableCard } from "@/components/ui/card";
import { EntrySummary } from "@/components/EntrySummary";
import type { DictEntry } from "@/db/types";

interface EntryCardProps {
  entry: DictEntry;
}

export function EntryCard({ entry }: EntryCardProps) {
  const router = useRouter();

  return (
    <PressableCard className="mb-2" onPress={() => router.push(`/dictionary/word/${entry.id}`)}>
      <EntrySummary entry={entry} />
    </PressableCard>
  );
}
