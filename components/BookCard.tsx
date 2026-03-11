import React from "react";
import { View, Image } from "react-native";
import { PressableCard, CardTitle, CardDescription } from "@/components/ui/card";
import { ProgressBar } from "@/components/ProgressBar";
import type { Book } from "@/db/types";

interface BookCardProps {
  book: Book;
  onPress: () => void;
}

function formatDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const BookCard = React.memo(function BookCard({ book, onPress }: BookCardProps) {
  const progress = book.readComplete
    ? 100
    : book.totalChars > 0
      ? Math.round((book.charOffset / book.totalChars) * 100)
      : Math.round(book.scrollPosition * 100);
  const lastRead = book.lastReadAt ? new Date(book.lastReadAt).toLocaleDateString() : null;

  return (
    <PressableCard onPress={onPress} className="mb-2 overflow-hidden">
      {book.imageUrl ? (
        <View className="flex-row">
          <Image
            source={{ uri: book.imageUrl }}
            className="w-16 h-16 rounded-md mr-3"
            resizeMode="cover"
          />
          <View className="flex-1 justify-center">
            <CardTitle numberOfLines={2}>{book.title}</CardTitle>
            {book.sourceUrl ? (
              <CardDescription numberOfLines={1} className="text-xs">
                {formatDomain(book.sourceUrl)}
              </CardDescription>
            ) : null}
          </View>
        </View>
      ) : (
        <>
          <CardTitle numberOfLines={1}>{book.title}</CardTitle>
          {book.author ? <CardDescription numberOfLines={1}>{book.author}</CardDescription> : null}
          {book.sourceUrl ? (
            <CardDescription numberOfLines={1} className="text-xs">
              {formatDomain(book.sourceUrl)}
            </CardDescription>
          ) : null}
        </>
      )}
      <View className="flex-row flex-wrap items-center gap-1.5 mt-1.5">
        {lastRead && (
          <View className="rounded-full bg-muted px-2 py-0.5">
            <CardDescription className="text-xs">{lastRead}</CardDescription>
          </View>
        )}
        {book.source !== "article" && (
          <View className="rounded-full bg-muted px-2 py-0.5">
            <CardDescription className="text-xs capitalize">{book.source}</CardDescription>
          </View>
        )}
        {(book.charOffset > 0 || book.scrollPosition > 0 || book.readComplete) && (
          <>
            <View className="flex-1" />
            <View className="rounded-full bg-muted px-2 py-0.5">
              <CardDescription className="text-xs">
                {progress}%
                {book.totalChars > 0 &&
                  (() => {
                    const charsPerPage = 500;
                    const totalPages = Math.ceil(book.totalChars / charsPerPage);
                    const currentPage = Math.round((progress / 100) * totalPages);
                    return ` ≈ ${currentPage} / ${totalPages} pages`;
                  })()}
              </CardDescription>
            </View>
          </>
        )}
      </View>
      {progress > 0 && <ProgressBar percent={progress} />}
    </PressableCard>
  );
});
