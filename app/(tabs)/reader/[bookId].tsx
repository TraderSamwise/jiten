import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { Text } from "@/components/ui/text";
import { DictionaryPopup } from "@/components/DictionaryPopup";
import { ReaderView, type ReaderViewRef } from "@/components/ReaderView";
import { ChevronLeft, SlidersHorizontal } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { generateReaderHtml } from "@/lib/reader-html";
import { parseAozoraToHtml, hasAozoraMarkup, plainTextToHtml } from "@/lib/aozora-parser";
import {
  smartLookup,
  smartLookupWithOffset,
  selectionLookup,
  type LookupResult,
} from "@/lib/smart-lookup";
import { parseBookRow } from "./index";
import type { Book } from "@/db/types";

export default function BookReaderScreen() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const userDb = useUserDb();
  const { dictDb } = useDatabase();
  const readerRef = useRef<ReaderViewRef>(null);

  const [book, setBook] = useState<Book | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<LookupResult[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(22);

  // Track scroll position for saving
  const scrollPosRef = useRef(0);

  // Load book
  useEffect(() => {
    if (!userDb || !bookId) return;
    (async () => {
      const row = await userDb.getFirstAsync<any>("SELECT * FROM books WHERE id = ?", [bookId]);
      if (!row) return;
      const b = parseBookRow(row);
      setBook(b);
      setFontSize(b.fontSize);

      if (b.rawContent) {
        const bookHtml = hasAozoraMarkup(b.rawContent)
          ? parseAozoraToHtml(b.rawContent)
          : plainTextToHtml(b.rawContent);
        const readerHtml = generateReaderHtml(bookHtml, {
          fontSize: b.fontSize,
          isDark,
          scrollPosition: b.scrollPosition,
        });
        setHtml(readerHtml);
      }

      // Update last_read_at
      const now = new Date().toISOString();
      await userDb.runAsync("UPDATE books SET last_read_at = ?, updated_at = ? WHERE id = ?", [
        now,
        now,
        bookId,
      ]);
    })();
  }, [userDb, bookId, isDark]);

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      if (userDb && bookId && scrollPosRef.current > 0) {
        userDb.runAsync("UPDATE books SET scroll_position = ?, updated_at = ? WHERE id = ?", [
          scrollPosRef.current,
          new Date().toISOString(),
          bookId,
        ]);
      }
    };
  }, [userDb, bookId]);

  const handleMessage = useCallback(
    async (data: string) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === "tap" || msg.type === "selection") {
          if (!dictDb) return;
          const text = msg.text as string;
          if (!text || text.length === 0) return;

          setLookupResults([]);
          setLookupLoading(true);
          setShowPopup(true);

          if (msg.type === "selection") {
            await selectionLookup(
              text,
              dictDb,
              (result) => {
                setLookupResults((prev) => [...prev, result]);
              },
              { prefix: msg.prefix || "", suffix: msg.suffix || "" },
            );
          } else {
            const tapOffset = msg.tapOffset as number | undefined;
            let results: LookupResult[];

            if (tapOffset && tapOffset > 0) {
              results = await smartLookupWithOffset(text, tapOffset, dictDb);
            } else {
              results = await smartLookup(text, dictDb);
            }
            setLookupResults(results);

            // Highlight matched text in reader (only for taps; selections have native highlight)
            if (results.length > 0) {
              const matchStart = results[0].matchStart ?? (tapOffset || 0);
              const startDelta = matchStart - (tapOffset || 0);
              readerRef.current?.postMessage(
                JSON.stringify({
                  type: "highlight",
                  start: startDelta,
                  length: results[0].matchedText.length,
                }),
              );
            }
          }
          setLookupLoading(false);
        } else if (msg.type === "scroll") {
          scrollPosRef.current = msg.position;
          // Debounced save to DB
          if (userDb && bookId) {
            userDb.runAsync("UPDATE books SET scroll_position = ?, updated_at = ? WHERE id = ?", [
              msg.position,
              new Date().toISOString(),
              bookId,
            ]);
          }
        }
      } catch {}
    },
    [dictDb, userDb, bookId],
  );

  const handleFontSizeChange = useCallback(
    (newSize: number) => {
      const rounded = Math.round(newSize);
      setFontSize(rounded);
      readerRef.current?.postMessage(JSON.stringify({ type: "setFontSize", size: rounded }));
      if (userDb && bookId) {
        userDb.runAsync("UPDATE books SET font_size = ?, updated_at = ? WHERE id = ?", [
          rounded,
          new Date().toISOString(),
          bookId,
        ]);
      }
    },
    [userDb, bookId],
  );

  if (!book || !html) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View
        className="flex-row items-center px-2 pb-2 border-b border-border bg-background"
        style={{ paddingTop: insets.top }}
      >
        <Pressable onPress={() => router.back()} className="p-2">
          <ChevronLeft size={24} className="text-foreground" />
        </Pressable>
        <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>
          {book.title}
        </Text>
        <Pressable onPress={() => setShowSettings(!showSettings)} className="p-2">
          <SlidersHorizontal size={20} className="text-foreground" />
        </Pressable>
      </View>

      {/* Settings panel */}
      {showSettings && (
        <View className="px-4 py-3 border-b border-border bg-background">
          <View className="flex-row items-center justify-center gap-4">
            <Pressable
              onPress={() => handleFontSizeChange(Math.max(14, fontSize - 2))}
              className="h-10 w-10 items-center justify-center rounded-lg border border-border"
            >
              <Text className="text-lg text-foreground">A-</Text>
            </Pressable>
            <Text className="text-base text-foreground w-8 text-center">{fontSize}</Text>
            <Pressable
              onPress={() => handleFontSizeChange(Math.min(32, fontSize + 2))}
              className="h-10 w-10 items-center justify-center rounded-lg border border-border"
            >
              <Text className="text-lg text-foreground">A+</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Reader content */}
      <ReaderView ref={readerRef} html={html} onMessage={handleMessage} />

      {/* Dictionary popup */}
      <DictionaryPopup
        visible={showPopup}
        loading={lookupLoading}
        onClose={() => {
          setShowPopup(false);
          setLookupResults([]);
          setLookupLoading(false);
          readerRef.current?.postMessage(JSON.stringify({ type: "clearHighlight" }));
        }}
        results={lookupResults}
      />
    </View>
  );
}
