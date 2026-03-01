import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, ActivityIndicator, Dimensions } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeGoBack } from "@/lib/navigation";
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

const TOOLTIP_W = 70;
const TOOLTIP_H = 32;
const TOOLTIP_GAP = 24;
const POPUP_SAFE_ZONE = 380;

function CopyTooltip({
  copyTooltip,
  readerY,
  isDark,
  copied,
  onPress,
}: {
  copyTooltip: { text: string; x: number; y: number };
  readerY: React.RefObject<number>;
  isDark: boolean;
  copied: boolean;
  onPress: () => void;
}) {
  const screen = Dimensions.get("window");
  const layoutY = readerY.current ?? 0;
  const rawTop = layoutY + copyTooltip.y - TOOLTIP_H - TOOLTIP_GAP;
  const top = Math.max(layoutY, Math.min(rawTop, screen.height - POPUP_SAFE_ZONE));
  const left = Math.max(8, Math.min(copyTooltip.x - TOOLTIP_W / 2, screen.width - TOOLTIP_W - 8));

  return (
    <Pressable
      onPress={onPress}
      style={{
        position: "absolute",
        zIndex: 101,
        top,
        left,
        backgroundColor: isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.85)",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
      }}
    >
      <Text
        style={{
          color: isDark ? "#000" : "#fff",
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </Text>
    </Pressable>
  );
}

export default function BookReaderScreen() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const goBack = useSafeGoBack("/reader");
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
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(22);
  const [copyTooltip, setCopyTooltip] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  // Track scroll position for saving
  const scrollPosRef = useRef(0);
  // Track ReaderView's Y offset in screen coordinates
  const readerLayoutY = useRef(0);
  // Store tap position while waiting for lookup results
  const pendingTapPos = useRef<{ x: number; y: number } | null>(null);

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
        // If content already has <ruby> HTML tags (e.g. from Aozora XHTML), use as-is
        const hasRubyTags = /<ruby[>\s]/.test(b.rawContent);
        const bookHtml = hasRubyTags
          ? b.rawContent
          : hasAozoraMarkup(b.rawContent)
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
          setLookupError(null);
          setShowPopup(true);
          setCopyTooltip(null);
          setCopied(false);

          if (msg.type === "selection") {
            // Show copy tooltip immediately for selections
            setCopyTooltip({
              text,
              x: msg.startX ?? 0,
              y: msg.startY ?? 0,
            });
            await selectionLookup(
              text,
              dictDb,
              (result) => {
                setLookupResults((prev) => [...prev, result]);
              },
              { prefix: msg.prefix || "", suffix: msg.suffix || "" },
            );
          } else {
            // Store tap position; tooltip shown after lookup
            pendingTapPos.current = { x: msg.x ?? 0, y: msg.y ?? 0 };
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
              // Show copy tooltip at tap position
              if (pendingTapPos.current) {
                setCopyTooltip({
                  text: results[0].matchedText,
                  x: pendingTapPos.current.x,
                  y: pendingTapPos.current.y,
                });
              }
            }
          }
          setLookupLoading(false);
        } else if (msg.type === "error") {
          setLookupResults([]);
          setLookupLoading(false);
          setLookupError(msg.message || "An error occurred");
          setShowPopup(true);
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

  const handleCopy = useCallback(() => {
    if (!copyTooltip) return;
    readerRef.current?.postMessage(
      JSON.stringify({ type: "copyToClipboard", text: copyTooltip.text }),
    );
    setCopied(true);
    setTimeout(() => {
      setCopyTooltip(null);
      setCopied(false);
    }, 800);
  }, [copyTooltip]);

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
        <Pressable onPress={() => goBack()} className="p-2">
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
      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          readerLayoutY.current = e.nativeEvent.layout.y;
        }}
      >
        <ReaderView ref={readerRef} html={html} onMessage={handleMessage} />
      </View>

      {/* Copy tooltip */}
      {copyTooltip && (
        <CopyTooltip
          copyTooltip={copyTooltip}
          readerY={readerLayoutY}
          isDark={isDark}
          copied={copied}
          onPress={handleCopy}
        />
      )}

      {/* Dictionary popup */}
      <DictionaryPopup
        visible={showPopup}
        loading={lookupLoading}
        errorMessage={lookupError}
        onClose={() => {
          setShowPopup(false);
          setLookupResults([]);
          setLookupLoading(false);
          setLookupError(null);
          setCopyTooltip(null);
          setCopied(false);
          readerRef.current?.postMessage(JSON.stringify({ type: "clearHighlight" }));
        }}
        results={lookupResults}
      />
    </View>
  );
}
