import React from "react";
import { View } from "react-native";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import type { Book } from "@/db/types";

interface BookCardProps {
  book: Book;
  onPress: () => void;
}

export const BookCard = React.memo(function BookCard({ book, onPress }: BookCardProps) {
  const progress =
    book.totalChars > 0
      ? Math.round((book.charOffset / book.totalChars) * 100)
      : Math.round(book.scrollPosition * 100);
  const lastRead = book.lastReadAt ? new Date(book.lastReadAt).toLocaleDateString() : null;

  return (
    <PressableCard onPress={onPress} className="mb-2">
      <CardTitle numberOfLines={1}>{book.title}</CardTitle>
      {book.author ? <CardDescription numberOfLines={1}>{book.author}</CardDescription> : null}
      <View className="flex-row items-center gap-3 mt-1">
        {lastRead && <CardDescription>{lastRead}</CardDescription>}
        {(book.charOffset > 0 || book.scrollPosition > 0) && (
          <CardDescription>{progress}%</CardDescription>
        )}
        <CardDescription className="capitalize">{book.source}</CardDescription>
      </View>
    </PressableCard>
  );
});
