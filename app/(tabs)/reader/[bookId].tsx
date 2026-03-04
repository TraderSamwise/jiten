import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, ActivityIndicator, Dimensions, Linking, Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeGoBack } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { Text } from "@/components/ui/text";
import { DictionaryPopup } from "@/components/DictionaryPopup";
import { ReaderView, type ReaderViewRef } from "@/components/ReaderView";
import { ChevronLeft, ChevronDown, SlidersHorizontal, BookText, User } from "@/lib/icons";
import { useUserDb } from "@/db/user-provider";
import { useDatabase } from "@/db/provider";
import { generateReaderHtml } from "@/lib/reader-html";
import {
  parseAozoraToHtml,
  hasAozoraMarkup,
  plainTextToHtml,
  stripAozoraBoilerplate,
} from "@/lib/aozora-parser";
import {
  type BookFormat,
  type TextModel,
  parseBookContent,
  sliceContent,
  calcCharsPerPage,
} from "@/lib/reader-model";
import {
  smartLookup,
  smartLookupWithOffset,
  selectionLookup,
  nameLookup,
  nameLookupWithOffset,
  type LookupResult,
} from "@/lib/smart-lookup";
import { parseBookRow } from "./index";
import type { Book } from "@/db/types";

const TOOLBAR_GAP = 24;
const POPUP_SAFE_ZONE = 380;

const EXTERNAL_DICTS = [
  {
    label: "Midori",
    url: (q: string) => `midori://search?text=${q}`,
    store: "https://apps.apple.com/app/midori-japanese-dictionary/id385231773",
  },
  {
    label: "Shirabe Jisho",
    url: (q: string) => `shirabelookup://search?w=${q}`,
    store: "https://apps.apple.com/app/shirabe-jisho/id1005203380",
  },
  {
    label: "DaKanji",
    url: (q: string) => `dakanji://dictionary?search=${q}`,
    store: "https://apps.apple.com/app/dakanji/id1548746810",
  },
  {
    label: "imiwa?",
    url: (q: string) => `imiwa://analyser?text=${q}`,
    store: "https://apps.apple.com/app/imiwa-japanese-dictionary/id288499125",
  },
];

function HighlightToolbar({
  tooltip,
  readerY,
  isDark,
  copied,
  onCopy,
}: {
  tooltip: { text: string; x: number; y: number };
  readerY: React.RefObject<number>;
  isDark: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const [openInExpanded, setOpenInExpanded] = useState(false);
  const screen = Dimensions.get("window");
  const layoutY = readerY.current ?? 0;
  const toolbarH = openInExpanded ? 76 : 32;
  const rawTop = layoutY + tooltip.y - toolbarH - TOOLBAR_GAP;
  const top = Math.max(layoutY, Math.min(rawTop, screen.height - POPUP_SAFE_ZONE));

  const bg = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.85)";
  const fg = isDark ? "#000" : "#fff";

  return (
    <View
      style={{
        position: "absolute",
        zIndex: 101,
        top,
        left: 0,
        right: 0,
        alignItems: "center",
      }}
      pointerEvents="box-none"
    >
      <View
        style={{
          backgroundColor: bg,
          borderRadius: 16,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 4,
          elevation: 5,
          paddingVertical: 6,
          paddingHorizontal: 4,
        }}
      >
        {/* Main row: Copy + Open in */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Pressable onPress={onCopy} style={{ paddingHorizontal: 10, paddingVertical: 2 }}>
            <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>
              {copied ? "Copied!" : "Copy"}
            </Text>
          </Pressable>
          {Platform.OS === "ios" && (
            <>
              <View style={{ width: 1, height: 16, backgroundColor: fg, opacity: 0.3 }} />
              <Pressable
                onPress={() => setOpenInExpanded(!openInExpanded)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>Open in</Text>
                <ChevronDown
                  size={14}
                  color={fg}
                  style={{
                    marginLeft: 2,
                    transform: [{ rotate: openInExpanded ? "180deg" : "0deg" }],
                  }}
                />
              </Pressable>
            </>
          )}
        </View>
        {/* Expanded: external dict buttons */}
        {openInExpanded && (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 4,
              marginTop: 6,
              paddingHorizontal: 4,
            }}
          >
            {EXTERNAL_DICTS.map((d) => (
              <Pressable
                key={d.label}
                onPress={() => {
                  const encoded = encodeURIComponent(tooltip.text);
                  Linking.openURL(d.url(encoded)).catch(() => {
                    Linking.openURL(d.store);
                  });
                }}
                style={{
                  backgroundColor: fg,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: bg, fontSize: 11, fontWeight: "600" }}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

export default function BookReaderScreen() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const goBack = useSafeGoBack("/reader");
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const userDb = useUserDb();
  const { dictDb, extendedDb } = useDatabase();
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
  const [nameMode, setNameMode] = useState(false);
  const nameModeRef = useRef(false);

  // Streaming prefetch refs — used by handleMessage for pageRendered
  const modelRef = useRef<TextModel | null>(null);
  const sliceCharOffsetRef = useRef(0);
  const isAozoraRef = useRef(false);
  const backPrefetchingRef = useRef(false);
  useEffect(() => {
    nameModeRef.current = nameMode;
  }, [nameMode]);

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

        if (hasRubyTags) {
          // Pre-formatted HTML — send entire content (no slicing)
          const readerHtml = generateReaderHtml(b.rawContent, {
            fontSize: b.fontSize,
            isDark,
            scrollPosition: b.scrollPosition,
          });
          setHtml(readerHtml);
        } else {
          // Aozora or plain text — slice ~3 pages from char offset
          const isAozora = hasAozoraMarkup(b.rawContent);
          const stripped = isAozora ? stripAozoraBoilerplate(b.rawContent) : b.rawContent;
          const format: BookFormat = isAozora ? "aozora" : "plain";
          const model = parseBookContent(stripped, format);

          const screen = Dimensions.get("window");
          const cpp = calcCharsPerPage(screen.width, screen.height, b.fontSize, false);

          // Legacy conversion: scroll_position → char_offset
          let charOffset = b.charOffset;
          if (charOffset === 0 && b.scrollPosition > 0) {
            charOffset = Math.round(b.scrollPosition * model.totalChars);
          }

          const startChar = Math.max(0, charOffset - cpp * 10);
          const totalBudget = charOffset - startChar + cpp * 3;
          const slice = sliceContent(model, startChar, totalBudget);
          const targetLocalChar = charOffset - startChar;

          console.log(
            `[READER LOAD] charOffset=${charOffset} startChar=${startChar} targetLocalChar=${targetLocalChar} cpp=${cpp} sliceLen=${slice.text.length} totalChars=${model.totalChars}`,
          );

          // Store refs for streaming prefetch
          modelRef.current = model;
          sliceCharOffsetRef.current = startChar;
          isAozoraRef.current = isAozora;

          // Save total_chars on first load
          if (b.totalChars === 0) {
            userDb.runAsync("UPDATE books SET total_chars = ? WHERE id = ?", [
              model.totalChars,
              bookId,
            ]);
          }

          const sliceHtml = isAozora
            ? parseAozoraToHtml(slice.text, { strip: false })
            : plainTextToHtml(slice.text);

          const readerHtml = generateReaderHtml(sliceHtml, {
            fontSize: b.fontSize,
            isDark,
            targetLocalChar,
            sliceCharOffset: startChar,
            totalChars: model.totalChars,
          });
          setHtml(readerHtml);
        }
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

  // Save char offset on unmount
  useEffect(() => {
    return () => {
      if (userDb && bookId && scrollPosRef.current > 0) {
        userDb.runAsync("UPDATE books SET char_offset = ?, updated_at = ? WHERE id = ?", [
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
          const text = msg.text as string;
          if (!text || text.length === 0) return;

          const isNameMode = nameModeRef.current;
          if (isNameMode && !extendedDb) return;
          if (!isNameMode && !dictDb) return;

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
            if (isNameMode) {
              // In name mode, just do a simple name lookup on the full selection
              const names = await nameLookup(text, extendedDb!);
              setLookupResults(names);
            } else {
              await selectionLookup(
                text,
                dictDb!,
                (result) => {
                  setLookupResults((prev) => [...prev, result]);
                },
                { prefix: msg.prefix || "", suffix: msg.suffix || "" },
              );
            }
          } else {
            // Store tap position; tooltip shown after lookup
            pendingTapPos.current = { x: msg.x ?? 0, y: msg.y ?? 0 };
            const tapOffset = msg.tapOffset as number | undefined;
            let results: LookupResult[];

            if (isNameMode) {
              results =
                tapOffset && tapOffset > 0
                  ? await nameLookupWithOffset(text, tapOffset, extendedDb!)
                  : await nameLookup(text, extendedDb!);
            } else {
              results =
                tapOffset && tapOffset > 0
                  ? await smartLookupWithOffset(text, tapOffset, dictDb!)
                  : await smartLookup(text, dictDb!);
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
          console.log(`[READER SAVE] charOffset=${msg.charOffset} ${msg._dbg || ""}`);
          scrollPosRef.current = msg.charOffset;
          if (userDb && bookId) {
            userDb.runAsync("UPDATE books SET char_offset = ?, updated_at = ? WHERE id = ?", [
              msg.charOffset,
              new Date().toISOString(),
              bookId,
            ]);
          }
        } else if (msg.type === "pageRendered") {
          const model = modelRef.current;
          if (!model) return;
          const globalLastChar = sliceCharOffsetRef.current + msg.lastCharIndex;
          const nextStart = globalLastChar + 1;
          if (nextStart < model.totalChars) {
            // Forward prefetch
            const screen = Dimensions.get("window");
            const cpp = calcCharsPerPage(screen.width, screen.height, fontSize, false);
            const nextSlice = sliceContent(model, nextStart, cpp * 3);
            const nextHtml = isAozoraRef.current
              ? parseAozoraToHtml(nextSlice.text, { strip: false })
              : plainTextToHtml(nextSlice.text);
            readerRef.current?.postMessage(
              JSON.stringify({
                type: "setNextContent",
                html: nextHtml,
                replaceFromChar: msg.lastCharIndex + 1,
              }),
            );
          }

          // Send debug info to WebView
          readerRef.current?.postMessage(
            JSON.stringify({
              type: "debug",
              text: `sliceOff: ${sliceCharOffsetRef.current}  globalLast: ${globalLastChar}/${modelRef.current?.totalChars}  fwd: ${nextStart < model.totalChars ? "yes" : "end"}`,
            }),
          );

          // Backward prefetch trigger
          const localPage = msg.localPage ?? 1;
          if (localPage <= 2 && sliceCharOffsetRef.current > 0 && !backPrefetchingRef.current) {
            backPrefetchingRef.current = true;
            const screen = Dimensions.get("window");
            const cpp = calcCharsPerPage(screen.width, screen.height, fontSize, false);
            const backStart = Math.max(0, sliceCharOffsetRef.current - cpp * 10);
            const backChars = sliceCharOffsetRef.current - backStart;
            if (backChars > 0) {
              const backSlice = sliceContent(model, backStart, backChars);
              const backHtml = isAozoraRef.current
                ? parseAozoraToHtml(backSlice.text, { strip: false })
                : plainTextToHtml(backSlice.text);
              readerRef.current?.postMessage(
                JSON.stringify({
                  type: "setPrevContent",
                  html: backHtml,
                  charCount: backChars,
                }),
              );
              sliceCharOffsetRef.current = backStart;
            } else {
              backPrefetchingRef.current = false;
            }
          }
        } else if (msg.type === "backPrefetchDone") {
          backPrefetchingRef.current = false;
        } else if (msg.type === "mfvcDebug") {
          console.log(`[MFVC] ${msg.msg}`);
        } else if (msg.type === "alignDebug") {
          console.log(`[ALIGN] ${msg.msg}`);
        }
      } catch {}
    },
    [dictDb, extendedDb, userDb, bookId, fontSize],
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
        {extendedDb && (
          <Pressable onPress={() => setNameMode(!nameMode)} className="p-2">
            {nameMode ? (
              <User size={20} className="text-primary" />
            ) : (
              <BookText size={20} className="text-muted-foreground" />
            )}
          </Pressable>
        )}
        <Pressable onPress={() => setShowSettings(!showSettings)} className="p-2">
          <SlidersHorizontal size={20} className="text-foreground" />
        </Pressable>
      </View>

      {/* Reader content */}
      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          readerLayoutY.current = e.nativeEvent.layout.y;
        }}
      >
        <ReaderView ref={readerRef} html={html} onMessage={handleMessage} />
        {/* Settings overlay — positioned absolute so it doesn't resize the reader */}
        {showSettings && (
          <View
            className="absolute left-0 right-0 top-0 px-4 py-3 border-b border-border bg-background"
            style={{ zIndex: 10 }}
          >
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
      </View>

      {/* Highlight toolbar: Copy + Open in (mobile only — web has native context menu) */}
      {Platform.OS !== "web" && copyTooltip && (
        <HighlightToolbar
          tooltip={copyTooltip}
          readerY={readerLayoutY}
          isDark={isDark}
          copied={copied}
          onCopy={handleCopy}
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
