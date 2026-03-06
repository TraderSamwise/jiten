import React from "react";
import { PressableCard } from "@/components/ui/card";
import { EntrySummary } from "@/components/EntrySummary";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useTabRouter } from "@/lib/navigation";
import type { DictEntry } from "@/db/types";

interface EntryCardProps {
  entry: DictEntry;
}

export const EntryCard = React.memo(function EntryCard({ entry }: EntryCardProps) {
  const tabRouter = useTabRouter();
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.has(`e:${entry.id}`));

  return (
    <PressableCard
      className={`mb-2 ${isBookmarked ? "bg-primary/5" : ""}`}
      onPress={() => tabRouter.pushWord(entry.id)}
    >
      <EntrySummary entry={entry} />
    </PressableCard>
  );
});
