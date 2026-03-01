import React from "react";
import { PressableCard } from "@/components/ui/card";
import { EntrySummary } from "@/components/EntrySummary";
import { useTabRouter } from "@/lib/navigation";
import type { DictEntry } from "@/db/types";

interface EntryCardProps {
  entry: DictEntry;
}

export function EntryCard({ entry }: EntryCardProps) {
  const tabRouter = useTabRouter();

  return (
    <PressableCard className="mb-2" onPress={() => tabRouter.pushWord(entry.id)}>
      <EntrySummary entry={entry} />
    </PressableCard>
  );
}
