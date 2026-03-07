import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Pressable,
  ActionSheetIOS,
  Platform,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeGoBack, useTabRouter } from "@/lib/navigation";
import { useContainerWidth } from "@/lib/use-container-width";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CustomHeaderScreen,
  HeaderPlaceholder,
  NavigatingOverlay,
  useWebBackdrop,
} from "@/components/CustomHeaderScreen";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  interpolate,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FlashcardSettingsModal } from "@/components/FlashcardSettingsModal";
import { StudyStatisticsModal } from "@/components/StudyStatisticsModal";
import { X, Settings, Info, Check, ChevronLeft, ChevronRight, Mic } from "@/lib/icons";
import { useVoiceRecognition } from "@/lib/voice-recognition";
import { toHiragana } from "wanakana";
import { PitchAccent, splitMorae } from "@/components/PitchAccent";
import { playEntryAudio } from "@/lib/audio";
import {
  romajiToKana,
  getTargetReading,
  getDisplayText,
  compareChars,
  isReadingComplete,
  getKanjiColor,
  hasFlickPending,
  type CharStatus,
} from "@/lib/typing-utils";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { getEntries } from "@/db/search";
import { reviewCard, Rating } from "@/stores/srs";
import {
  simpleGraduate,
  simpleReviewFail,
  simpleInitCard,
  dateToSrsEpochDays,
  SIMPLE_SRS_REQUIRED_CORRECT,
} from "@/stores/simple-srs";
import { useAtomValue } from "jotai";
import { useListsStore, parseListRow } from "@/stores/lists";
import {
  flashcardFlipAnimationAtom,
  flashcardSwipeAnimationAtom,
  flashcardButtonAnimationAtom,
} from "@/stores/settings";
import {
  shouldCheckConfusion,
  findConfusedWords,
  findMeaningConfusion,
  type ConfusedWordResult,
} from "@/lib/confused-words";
import { logPracticeEvent, logSessionSummary, recordConfusion } from "@/lib/practice-logger";
import { getSimilarKanjiAsync, getKanjiBatchAsync } from "@/db/kanji-search";
import { useSync } from "@/db/sync-provider";
import { Banner } from "@/components/Banner";
import type { DictEntry, KanjiCharacter, CardFace, SrsCardRow, FlashcardMode } from "@/db/types";
import type { Card as FsrsCard } from "ts-fsrs";

const CONFUSION_COOLDOWN_HOURS = 24;

const NEW_CARD_BATCH_SIZE = 5;
const CARD_PEEK = 40;
const CARD_GAP = 16;
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY = 500;
const SLIDE_DURATION = 250;
const FLIP_DURATION = 300;

interface FloatingRating {
  key: number;
  label: string;
  color: string;
  x: number;
  y: number;
}

// ─── Floating rating label (floats up from button and fades) ───
function RatingFloat({
  label,
  color,
  screenX,
  screenY,
  onDone,
}: {
  label: string;
  color: string;
  screenX: number;
  screenY: number;
  onDone: () => void;
}) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    translateY.value = withTiming(-60, { duration: 800, easing: Easing.out(Easing.quad) });
    opacity.value = withTiming(0, { duration: 800, easing: Easing.in(Easing.quad) });
    const timer = setTimeout(onDone, 900);
    return () => clearTimeout(timer);
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: screenY - 8,
          left: screenX - 40,
          width: 80,
          alignItems: "center",
          zIndex: 100,
        },
        style,
      ]}
    >
      <Text style={{ color, fontWeight: "800", fontSize: 18 }}>{label}</Text>
    </Animated.View>
  );
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// --- Self-contained typing input component ---
function TypingInput({
  entry,
  onComplete,
  frontFaceIsKanji,
}: {
  entry: DictEntry;
  onComplete: (wasCorrect: boolean) => void;
  frontFaceIsKanji: boolean;
}) {
  const [typedRomaji, setTypedRomaji] = useState("");
  const [furiganaRevealed, setFuriganaRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [isKanaInput, setIsKanaInput] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const targetReading = getTargetReading(entry);
  const displayText = getDisplayText(entry);
  const targetChars = [...targetReading];
  const displayChars = [...displayText];
  const displayDiffersFromReading = displayText !== targetReading;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Compute char statuses from current typed kana
  const converted = romajiToKana(typedRomaji);
  const flickPending = isKanaInput && hasFlickPending(converted, targetReading);

  let charStatuses: CharStatus[] = compareChars(converted, targetReading);
  if (flickPending && charStatuses.length > 0) {
    const lastIdx = [...converted].length - 1;
    if (lastIdx >= 0 && lastIdx < charStatuses.length && charStatuses[lastIdx] === "wrong") {
      charStatuses = [...charStatuses];
      charStatuses[lastIdx] = "pending";
    }
  }

  // Pitch accent data
  const pitch = entry.pitchAccents.find((pa) => pa.reading === targetReading);
  const morae = pitch ? splitMorae(targetReading) : [];
  const moraCharOffsets: number[] = [];
  if (pitch) {
    let offset = 0;
    for (const mora of morae) {
      moraCharOffsets.push(offset);
      offset += mora.length;
    }
  }

  const coloredMoraRenderer = (mora: string, moraIndex: number) => {
    const start = moraCharOffsets[moraIndex] ?? 0;
    return (
      <View className="flex-row">
        {[...mora].map((char, ci) => {
          const charIdx = start + ci;
          return (
            <Text
              key={ci}
              className={`text-sm ${
                charStatuses[charIdx] === "correct"
                  ? "text-green-500"
                  : charStatuses[charIdx] === "wrong"
                    ? "text-red-500"
                    : charStatuses[charIdx] === "pending"
                      ? "text-green-300"
                      : "text-muted-foreground"
              }`}
            >
              {char}
            </Text>
          );
        })}
      </View>
    );
  };

  function handleInput(raw: string) {
    if (done) return;

    // Detect kana keyboard
    let kanaInput = isKanaInput;
    if (raw.length > 0) {
      const lastCode = raw.charCodeAt(raw.length - 1);
      kanaInput = lastCode >= 0x3040 && lastCode <= 0x30ff;
      setIsKanaInput(kanaInput);
    }

    setTypedRomaji(raw);
    const conv = romajiToKana(raw);

    const isFlickPending = kanaInput && hasFlickPending(conv, targetReading);

    // Auto-furigana: reveal on mistype (but not if flick-pending)
    if (frontFaceIsKanji && !furiganaRevealed) {
      const statuses = compareChars(conv, targetReading);
      if (statuses.some((s) => s === "wrong") && !isFlickPending) {
        setFuriganaRevealed(true);
      }
    }

    // Check complete
    if (isReadingComplete(conv, entry) || isReadingComplete(raw, entry)) {
      setDone(true);
      inputRef.current?.blur();
      onComplete(true);
      return;
    }

    // Over-length check: kana count >= target length -> fail
    const targetLen = targetChars.length;
    const kanaCount = [...conv].filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x3040 && code <= 0x30ff;
    }).length;
    if (kanaCount >= targetLen && targetLen > 0) {
      if (isFlickPending) return;
      setDone(true);
      inputRef.current?.blur();
      onComplete(false);
      return;
    }
  }

  function handleSubmitEditing() {
    if (done) return;
    if (frontFaceIsKanji && !furiganaRevealed) {
      // First Enter: reveal furigana hint
      setFuriganaRevealed(true);
    } else {
      // Second Enter (or non-kanji front): give up
      setDone(true);
      inputRef.current?.blur();
      onComplete(false);
    }
  }

  // Color helper for kana chars
  const charColorClass = (status: CharStatus) =>
    status === "correct"
      ? "text-green-500"
      : status === "wrong"
        ? "text-red-500"
        : status === "pending"
          ? "text-green-300"
          : "text-muted-foreground";

  return (
    <Pressable onPress={() => inputRef.current?.focus()} className="items-center">
      {/* Furigana row (only when front face is kanji and display differs from reading) */}
      {frontFaceIsKanji &&
        displayDiffersFromReading &&
        (furiganaRevealed ? (
          pitch ? (
            <PitchAccent
              accent={pitch}
              renderMora={coloredMoraRenderer}
              lineColor={
                charStatuses[0] === "correct"
                  ? "#22c55e"
                  : charStatuses[0] === "wrong"
                    ? "#ef4444"
                    : charStatuses[0] === "pending"
                      ? "#86efac"
                      : "#a1a1aa"
              }
            />
          ) : (
            <View className="flex-row">
              {targetChars.map((char, i) => (
                <Text key={i} className={`text-sm ${charColorClass(charStatuses[i])}`}>
                  {char}
                </Text>
              ))}
            </View>
          )
        ) : pitch ? (
          <View style={{ opacity: 0 }} pointerEvents="none">
            <PitchAccent accent={pitch} />
          </View>
        ) : (
          <Text className="text-sm text-transparent">{targetReading}</Text>
        ))}

      {/* Display text with color coding */}
      {frontFaceIsKanji ? (
        <View className="flex-row">
          {displayChars.map((char, i) => {
            const color = getKanjiColor(displayChars, charStatuses, targetChars.length, i);
            const colorClass =
              color === "green"
                ? "text-green-500"
                : color === "red"
                  ? "text-red-500"
                  : color === "pending"
                    ? "text-green-300"
                    : "text-foreground";
            return (
              <Text key={i} className={`text-3xl font-bold ${colorClass}`}>
                {char}
              </Text>
            );
          })}
        </View>
      ) : (
        /* Kana/english front: show reading chars with color coding */
        <View className="flex-row justify-center">
          {targetChars.map((char, i) => (
            <Text
              key={i}
              className={`text-2xl font-bold ${charColorClass(charStatuses[i] ?? "untyped")}`}
            >
              {char}
            </Text>
          ))}
        </View>
      )}

      {/* Visible TextInput -- triggers virtual keyboard on mobile */}
      <TextInput
        ref={inputRef}
        className="mt-4 w-48 h-10 rounded-lg border border-border bg-background px-3 text-center text-foreground text-lg"
        value={typedRomaji}
        onChangeText={handleInput}
        onSubmitEditing={handleSubmitEditing}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        placeholder="Type reading..."
        placeholderTextColor="#999"
      />
    </Pressable>
  );
}

function getFaceText(entry: DictEntry, face: CardFace): string {
  switch (face) {
    case "kanji":
      return entry.kanji[0]?.text ?? entry.kana[0]?.text ?? "";
    case "kana":
      return entry.kana[0]?.text ?? "";
    case "english": {
      const glosses =
        entry.senses[0]?.glosses.filter((g) => g.lang === "eng").map((g) => g.text) ?? [];
      const sep = glosses.some((g) => g.includes(",")) ? "; " : ", ";
      return glosses.join(sep);
    }
  }
}

function getKanjiFaceText(kanji: KanjiCharacter, face: CardFace): string {
  switch (face) {
    case "kanji":
      return kanji.literal;
    case "kana":
      return [...kanji.readingsOn, ...kanji.readingsKun].join("\u3001");
    case "english":
      return kanji.meanings.join(", ");
  }
}

const FACE_ORDER: Record<CardFace, number> = { kanji: 0, kana: 1, english: 2 };
function sortFaces(faces: CardFace[]): CardFace[] {
  return [...faces].sort((a, b) => FACE_ORDER[a] - FACE_ORDER[b]);
}

const BASE_FONT_SIZE = 96;
const MAX_ENGLISH_FONT_SIZE = 18;
function scaledFontStyle(
  count: number,
  face: CardFace,
): { fontSize: number; lineHeight: number; textAlign: "center" } {
  const scale = 1 / (1 + (count - 1) * 0.5);
  const typeFactor = face === "english" ? 0.5 : face === "kana" ? 0.8 : 1;
  let size = Math.round(BASE_FONT_SIZE * scale * typeFactor);
  if (face === "english") size = Math.min(size, MAX_ENGLISH_FONT_SIZE);
  return { fontSize: size, lineHeight: Math.round(size * 1.3), textAlign: "center" as const };
}

// --- Self-contained card view: owns flip animation, stats, content rendering ---
interface StudyCardViewProps {
  item: QueueItem;
  status: CardStatus;
  initialFlipped: boolean;
  disableFlipAnimation: boolean;
  frontFaces: CardFace[];
  backFaces: CardFace[];
  flashcardMode: FlashcardMode;
  simpleCorrectCount: number;
  // Voice/typing (only active for cursor card)
  voiceStatus: "idle" | "correct" | "wrong";
  voiceHeard: string | null;
  isListening: boolean;
  typingMode: boolean;
  voiceMode: boolean;
  // Callbacks
  onFlip: () => void;
  onTypingComplete: (wasCorrect: boolean) => void;
  onInfoPress: () => void;
}

interface StudyCardViewHandle {
  toggle: () => void;
}

const StudyCardView = React.memo(
  React.forwardRef<StudyCardViewHandle, StudyCardViewProps>(function StudyCardView(
    {
      item,
      status,
      initialFlipped,
      disableFlipAnimation,
      frontFaces,
      backFaces,
      flashcardMode,
      simpleCorrectCount,
      voiceStatus,
      voiceHeard,
      isListening,
      typingMode,
      voiceMode,
      onFlip,
      onTypingComplete,
      onInfoPress,
    },
    ref,
  ) {
    const screenWidth = useContainerWidth();
    // Per-card flip animation
    const flipProgress = useSharedValue(initialFlipped ? 1 : 0);
    const [flipped, setFlipped] = useState(initialFlipped);
    const prevInitialFlipped = useRef(initialFlipped);

    // React to parent changing flip state (voice recognition flip, or re-rate reset)
    // Skip if card already matches (e.g. toggle() already flipped us)
    useEffect(() => {
      if (initialFlipped !== prevInitialFlipped.current) {
        prevInitialFlipped.current = initialFlipped;
        if (initialFlipped === flipped) return; // already in sync
        if (initialFlipped && !flipped) {
          // Parent wants us to flip (e.g. voice recognition correct)
          setFlipped(true);
          if (disableFlipAnimation) {
            flipProgress.value = 1;
          } else {
            flipProgress.value = 0;
            flipProgress.value = withTiming(1, {
              duration: FLIP_DURATION,
              easing: Easing.inOut(Easing.ease),
            });
          }
        } else {
          // Reset (e.g. re-rate unflips future cards)
          setFlipped(initialFlipped);
          flipProgress.value = initialFlipped ? 1 : 0;
        }
      }
    }, [initialFlipped]);

    function toggle() {
      const wasFlipped = flipped;
      setFlipped(!wasFlipped);
      if (disableFlipAnimation) {
        flipProgress.value = wasFlipped ? 0 : 1;
      } else {
        flipProgress.value = wasFlipped ? 1 : 0;
        flipProgress.value = withTiming(wasFlipped ? 0 : 1, {
          duration: FLIP_DURATION,
          easing: Easing.inOut(Easing.ease),
        });
      }
      if (!wasFlipped) onFlip();
    }

    React.useImperativeHandle(ref, () => ({ toggle }));

    const frontFaceStyle = useAnimatedStyle(() => {
      const rotateX = interpolate(flipProgress.value, [0, 0.5], [0, 90]);
      const opacity = flipProgress.value < 0.5 ? 1 : 0;
      return {
        backfaceVisibility: "hidden" as const,
        transform: [{ perspective: 1000 }, { rotateY: `${rotateX}deg` }],
        opacity,
      };
    });

    const backFaceStyle = useAnimatedStyle(() => {
      const rotateX = interpolate(flipProgress.value, [0.5, 1], [-90, 0]);
      const opacity = flipProgress.value >= 0.5 ? 1 : 0;
      return {
        backfaceVisibility: "hidden" as const,
        transform: [{ perspective: 1000 }, { rotateY: `${rotateX}deg` }],
        opacity,
      };
    });

    // Stats & checks
    const stats = getCardStats(item.srsCard, flashcardMode);
    const checkCount =
      flashcardMode === "simple_srs" && item.srsCard
        ? (simpleCorrectCount ?? getCheckCount(item.srsCard, "simple_srs"))
        : getCheckCount(item.srsCard, flashcardMode);

    // Render kana face with pitch accent visualization when available
    function renderFaceContent(
      face: CardFace,
      style: { fontSize: number; lineHeight: number; textAlign: "center" },
      opts?: { numberOfLines?: number; adjustsFontSizeToFit?: boolean; minimumFontScale?: number },
    ) {
      const text =
        item.kind === "entry" ? getFaceText(item.entry, face) : getKanjiFaceText(item.kanji, face);

      if (face === "kana" && item.kind === "entry" && item.entry.pitchAccents.length > 0) {
        const accent = item.entry.pitchAccents[0];
        const moraCount = splitMorae(accent.reading).length;
        // Cap font size so all morae fit: card text area ≈ 45% of screen width
        const availableWidth = screenWidth * 0.45;
        const maxFontForFit = Math.floor(availableWidth / moraCount);
        const MAX_PITCH_KANA = 36;
        const fontSize = Math.min(style.fontSize, maxFontForFit, MAX_PITCH_KANA);
        const lineHeight = Math.round(fontSize * 1.3);
        return (
          <PitchAccent
            accent={accent}
            fontSize={fontSize}
            renderMora={(mora) => (
              <Text style={{ fontSize, lineHeight }} className="text-foreground">
                {mora}
              </Text>
            )}
          />
        );
      }

      return (
        <Text
          style={style}
          className="text-foreground"
          numberOfLines={opts?.numberOfLines}
          adjustsFontSizeToFit={opts?.adjustsFontSizeToFit}
          minimumFontScale={opts?.minimumFontScale}
        >
          {text}
        </Text>
      );
    }

    // --- Front content ---
    function renderFront() {
      const isTyping = typingMode && status === "pending" && item.kind === "entry";
      const frontIsKanji =
        item.kind === "entry" &&
        frontFaces[0] === "kanji" &&
        getDisplayText(item.entry) !== getTargetReading(item.entry);

      const handleTypingComplete = (wasCorrect: boolean) => {
        toggle(); // flip the card
        onTypingComplete(wasCorrect);
      };

      const frontCount = frontFaces.length;
      const secondaryFaces = frontFaces.slice(1).map((face, i) => (
        <View key={`front-${i}`} style={{ marginTop: 4 }}>
          {renderFaceContent(face, scaledFontStyle(frontCount, face), {
            numberOfLines: face === "english" ? 3 : 1,
            adjustsFontSizeToFit: face !== "english",
            minimumFontScale: 0.5,
          })}
        </View>
      ));

      return (
        <View className="items-center justify-center flex-1">
          {isTyping && frontIsKanji && item.kind === "entry" ? (
            <TypingInput
              key={item.entry.id}
              entry={item.entry}
              frontFaceIsKanji
              onComplete={handleTypingComplete}
            />
          ) : (
            <>
              {renderFaceContent(frontFaces[0], scaledFontStyle(frontCount, frontFaces[0]), {
                numberOfLines: frontFaces[0] === "english" ? 3 : 1,
                adjustsFontSizeToFit: frontFaces[0] !== "english",
                minimumFontScale: 0.5,
              })}
              {isTyping && item.kind === "entry" && (
                <View className="mt-6 items-center w-full px-4">
                  <TypingInput
                    key={item.entry.id}
                    entry={item.entry}
                    frontFaceIsKanji={false}
                    onComplete={handleTypingComplete}
                  />
                </View>
              )}
            </>
          )}
          {secondaryFaces}
          {!isTyping && voiceMode && item.kind === "entry" && (
            <View className="mt-6 items-center">
              {voiceStatus === "correct" ? (
                <Text className="text-lg font-bold text-green-500">Correct!</Text>
              ) : voiceStatus === "wrong" ? (
                <>
                  <Text className="text-lg font-bold text-red-500">Try again</Text>
                  {voiceHeard && (
                    <Text className="text-sm text-muted-foreground mt-1">Heard: {voiceHeard}</Text>
                  )}
                </>
              ) : (
                <>
                  <Mic
                    size={24}
                    className={isListening ? "text-primary" : "text-muted-foreground"}
                  />
                  <Text className="text-sm text-muted-foreground mt-1">Say the reading...</Text>
                </>
              )}
            </View>
          )}
        </View>
      );
    }

    // --- Back content ---
    function renderBack() {
      const totalFaceCount = frontFaces.length + backFaces.length;

      // Back face uses fixed smaller sizes — no adjustsFontSizeToFit needed
      const backKanjiSize = 28;
      const backEnglishSize = MAX_ENGLISH_FONT_SIZE;

      function backFontStyle(face: CardFace) {
        const size = face === "english" ? backEnglishSize : face === "kana" ? 22 : backKanjiSize;
        return { fontSize: size, lineHeight: Math.round(size * 1.3), textAlign: "center" as const };
      }

      return (
        <View className="items-center justify-center flex-1">
          {renderFaceContent(frontFaces[0], backFontStyle(frontFaces[0]))}
          {frontFaces.slice(1).map((face, i) => (
            <View key={`front-${i}`} style={{ marginTop: 4 }}>
              {renderFaceContent(face, backFontStyle(face))}
            </View>
          ))}
          <View className="mt-6 items-center">
            <View className="h-px w-48 bg-muted-foreground/30 mb-4" />
            {renderFaceContent(backFaces[0], backFontStyle(backFaces[0]), {
              numberOfLines: backFaces[0] === "english" ? 4 : undefined,
            })}
            {backFaces.slice(1).map((face, i) => (
              <View key={`back-${i}`} style={{ marginTop: 4 }}>
                {renderFaceContent(face, backFontStyle(face), {
                  numberOfLines: face === "english" ? 4 : undefined,
                })}
              </View>
            ))}
          </View>
        </View>
      );
    }

    function renderOverlays() {
      return (
        <>
          {stats && (
            <View style={{ position: "absolute", top: 10, left: 12, zIndex: 1 }}>
              <Text className="text-xs text-muted-foreground">{stats}</Text>
            </View>
          )}
          <View
            style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
            className="flex-row items-center gap-1"
          >
            {Array.from({ length: checkCount }, (_, ci) => (
              <Check key={ci} size={14} className="text-green-500" style={{ marginRight: -4 }} />
            ))}
            <GestureDetector gesture={Gesture.Tap().onEnd(() => runOnJS(onInfoPress)())}>
              <View style={{ marginLeft: 8, padding: 8, margin: -8 }}>
                <Info size={18} className="text-muted-foreground" />
              </View>
            </GestureDetector>
          </View>
        </>
      );
    }

    return (
      <View style={{ flex: 1, position: "relative" }}>
        <Animated.View style={[frontFaceStyle, { flex: 1 }]}>
          <Card
            className="flex-1 items-center justify-center bg-secondary dark:bg-zinc-900"
            style={{ overflow: "hidden" }}
          >
            {renderOverlays()}
            {renderFront()}
          </Card>
        </Animated.View>
        <Animated.View
          style={[backFaceStyle, { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }]}
        >
          <Card
            className="flex-1 items-center justify-center bg-secondary dark:bg-zinc-900"
            style={{ overflow: "hidden", padding: 16 }}
          >
            {renderOverlays()}
            {renderBack()}
          </Card>
        </Animated.View>
      </View>
    );
  }),
);

type QueueItem =
  | { kind: "entry"; entry: DictEntry; srsCard?: SrsCardRow }
  | { kind: "kanji"; kanji: KanjiCharacter; srsCard?: SrsCardRow };

function getQueueItemId(item: QueueItem): string {
  return item.kind === "entry" ? `e:${item.entry.id}` : `k:${item.kanji.literal}`;
}

interface SrsSnapshot {
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  simpleStage: number | null;
  simpleN: number | null;
  simpleInterval: number | null;
  lastConfusionCheck: string | null;
}

type CardStatus = "pending" | "revealed" | "rated";

interface StudyCard {
  item: QueueItem;
  status: CardStatus;
  flipped: boolean;
  rating?: "pass" | "fail" | "easy";
  snapshot?: SrsSnapshot | null;
  reviewLogId?: string | null;
  preStudyPosition?: number | null;
  wasNewSimpleSrs?: boolean;
  reQueueOf?: number;
}

function captureSnapshot(card: SrsCardRow): SrsSnapshot {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview,
    simpleStage: card.simpleStage,
    simpleN: card.simpleN,
    simpleInterval: card.simpleInterval,
    lastConfusionCheck: card.lastConfusionCheck,
  };
}

function getCheckCount(srsCard: SrsCardRow | undefined, mode: FlashcardMode): number {
  if (!srsCard) return 0;

  if (mode === "simple_srs") {
    if (srsCard.simpleStage == null) return 0;
    if (srsCard.simpleStage === 1) return 3; // graduated
    // stage 0 (learning): 1 check after init, 2 if interval has grown
    return srsCard.simpleInterval != null && srsCard.simpleInterval > 0.5 ? 2 : 1;
  }

  if (mode === "srs") {
    if (srsCard.state === 0) return 0; // new
    if (srsCard.state === 2) return 3; // review (graduated)
    if (srsCard.state === 3) return 1; // relearning
    // state 1 (learning): use reps count
    return Math.min(srsCard.reps, 2) || 1;
  }

  return 0; // add_order -- no SRS checks
}

function formatInterval(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function getCardStats(srsCard: SrsCardRow | undefined, mode: FlashcardMode): string | null {
  if (!srsCard) return null;
  if (mode === "simple_srs") {
    if (srsCard.simpleStage == null || srsCard.simpleInterval == null) return null;
    const interval = formatInterval(srsCard.simpleInterval);
    const lapses = srsCard.lapses;
    return lapses > 0 ? `${interval} \u00B7 ${lapses} lapse${lapses > 1 ? "s" : ""}` : interval;
  }
  if (mode === "srs") {
    if (srsCard.state === 0) return null; // new card
    const interval = formatInterval(srsCard.scheduledDays);
    const lapses = srsCard.lapses;
    return lapses > 0 ? `${interval} \u00B7 ${lapses} lapse${lapses > 1 ? "s" : ""}` : interval;
  }
  return null;
}

// Lightweight shell -- defers mounting the heavy study UI until after nav animation
export default function StudyScreenShell() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(t);
  }, []);

  if (!ready) {
    return (
      <CustomHeaderScreen>
        <HeaderPlaceholder py="py-2" spacerHeight={40} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      </CustomHeaderScreen>
    );
  }

  return <StudyScreen />;
}

function StudyScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const router = useRouter();
  const tabRouter = useTabRouter();
  const navigateBack = useSafeGoBack("/lists");
  const insets = useSafeAreaInsets();
  const clampedWidth = useContainerWidth();
  const { webBgStyle } = useWebBackdrop();
  const { dictDb, audioDb } = useDatabase();
  const userDb = useUserDb();
  const { triggerSync, markDirty } = useSync();
  const sessionDirtyRef = useRef(false);
  const storeList = useListsStore((s) => s.lists.find((l) => l.id === listId));
  const setLists = useListsStore((s) => s.setLists);
  const updateList = useListsStore((s) => s.updateList);
  const [syncWarning, setSyncWarning] = useState(false);

  // Sync on unmount if any SRS updates were made during this session
  useEffect(
    () => () => {
      if (sessionDirtyRef.current) triggerSync(true);
    },
    [],
  );

  const [localList, setLocalList] = useState<typeof storeList>(undefined);
  const list = storeList ?? localList;
  const flipAnimationEnabled = useAtomValue(flashcardFlipAnimationAtom);
  const swipeAnimationEnabled = useAtomValue(flashcardSwipeAnimationAtom);
  const buttonAnimationEnabled = useAtomValue(flashcardButtonAnimationAtom);

  // --- Single array + cursor (replaces queue/currentIndex/history/historyIndex/revealed) ---
  const [cards, setCards] = useState<StudyCard[]>([]);
  const cardsRef = useRef<StudyCard[]>([]);
  cardsRef.current = cards;
  const [cursor, setCursor] = useState(0);
  const [originalCardCount, setOriginalCardCount] = useState(0);

  // Derived state
  const currentCard = cards[cursor];
  const displayItem = currentCard?.item;
  const revealed = currentCard?.flipped ?? false;
  const isBrowsingHistory = currentCard?.status === "rated";

  const [loading, setLoading] = useState(true);
  const [navigating, setNavigating] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const [longPressActive, setLongPressActive] = useState(false);
  // Floating rating labels
  const [floatingRatings, setFloatingRatings] = useState<FloatingRating[]>([]);
  const floatingKeyRef = useRef(0);
  const failButtonRef = useRef<View>(null);
  const passButtonRef = useRef<View>(null);
  const revealedRef = useRef(false);
  const revealTimeRef = useRef(0);
  const sessionIdRef = useRef("");
  const sessionStartRef = useRef("");
  const sessionCorrectRef = useRef(0);
  const cursorCardRef = useRef<StudyCardViewHandle>(null);
  // Simple SRS progress: learned/total (only increments on new cards)
  const [simpleSrsLearned, setSimpleSrsLearned] = useState(0);
  const [simpleSrsTotal, setSimpleSrsTotal] = useState(0);
  // Simple SRS: track correct-in-a-row per card (need 3 to graduate)
  const simpleCorrectCountRef = useRef(new Map<string, number>());

  // Confused words detection
  const [confusedWordsVisible, setConfusedWordsVisible] = useState(false);
  const [confusedResults, setConfusedResults] = useState<ConfusedWordResult[]>([]);
  const [confusedFailedEntry, setConfusedFailedEntry] = useState<DictEntry | null>(null);

  // Pre-selected rating from typing/voice completion
  const [preSelectedRating, setPreSelectedRating] = useState<"pass" | "fail" | null>(null);

  // Voice recognition state
  const [voiceHeard, setVoiceHeard] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "correct" | "wrong">("idle");
  const voiceAutoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceWrongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Carousel animation shared values
  const translateX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);

  // Voice recognition: enabled when voice mode is on, card is pending, not browsing history
  const voiceEnabled =
    !!list?.voiceMode && !revealed && !isBrowsingHistory && !sessionDone && !loading;

  const voiceCallbackRef = useRef<(transcript: string) => void>(() => {});

  const { isListening } = useVoiceRecognition({
    enabled: voiceEnabled,
    onResult: (transcript: string) => voiceCallbackRef.current(transcript),
  });

  // Clean up voice/typing timers on unmount
  useEffect(() => {
    return () => {
      if (voiceAutoAdvanceRef.current) clearTimeout(voiceAutoAdvanceRef.current);
      if (voiceWrongTimerRef.current) clearTimeout(voiceWrongTimerRef.current);
    };
  }, []);

  // Reset voice/typing state when cursor changes
  useEffect(() => {
    setVoiceStatus("idle");
    setVoiceHeard(null);
    setPreSelectedRating(null);
    if (voiceAutoAdvanceRef.current) {
      clearTimeout(voiceAutoAdvanceRef.current);
      voiceAutoAdvanceRef.current = null;
    }
    if (voiceWrongTimerRef.current) {
      clearTimeout(voiceWrongTimerRef.current);
      voiceWrongTimerRef.current = null;
    }
  }, [cursor]);

  // Log session summary when study session completes (all cards done — rare for large decks)
  useEffect(() => {
    if (sessionDone && reviewedCount > 0 && userDb && listId && sessionIdRef.current) {
      const practiceMode = list?.typingMode
        ? "typing_flashcard"
        : list?.voiceMode
          ? "voice"
          : "flashcard";
      logSessionSummary(userDb, {
        sessionId: sessionIdRef.current,
        listId,
        practiceMode,
        startedAt: sessionStartRef.current,
        durationMs: Date.now() - new Date(sessionStartRef.current).getTime(),
        totalItems: reviewedCount,
        correctCount: sessionCorrectRef.current,
      }).catch(() => {});
    }
  }, [sessionDone]);

  // Web: keyboard shortcuts for reveal / rating
  useEffect(() => {
    if (Platform.OS !== "web") return;
    function handleKeyDown(e: KeyboardEvent) {
      const isRevealed = revealedRef.current;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isInInput = tag === "INPUT" || tag === "TEXTAREA";

      if (e.key === "Enter" || e.key === " ") {
        // When typing input is focused and card not revealed, let it handle the event
        if (isInInput && !isRevealed) return;
        e.preventDefault();
        e.stopPropagation();
        if (isBrowsingHistory) return;
        if (!isRevealed) {
          cursorCardRef.current?.toggle();
        } else if (preSelectedRating === "fail") {
          handleFail();
        } else {
          handlePass(false);
        }
        return;
      }
      if (!isBrowsingHistory) {
        if (e.key === "1") {
          e.preventDefault();
          handleFail();
        }
        if (e.key === "2") {
          e.preventDefault();
          handlePass(false);
        }
        if (e.key === "3") {
          e.preventDefault();
          handlePass(true);
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  });

  // Fetch list from DB if not in store (e.g. direct navigation, hot-reload)
  useEffect(() => {
    if (storeList || !userDb || !listId) return;
    userDb
      .getFirstAsync<any>("SELECT * FROM lists WHERE id = ? AND deleted_at IS NULL", [listId])
      .then((row: any) => {
        if (row) {
          const parsed = parseListRow(row);
          setLocalList(parsed);
          setLists([...useListsStore.getState().lists, parsed]);
        }
      })
      .catch(() => {});
  }, [userDb, listId, storeList]);

  useEffect(() => {
    if (!dictDb || !userDb || !list) return;
    // Attempt sync before loading queue (5s timeout), non-blocking
    const syncAttempt = Promise.race([
      triggerSync(),
      new Promise((r) => setTimeout(r, 5000)),
    ]).catch(() => {});
    syncAttempt.then((result: any) => {
      if (result && !result.ok) setSyncWarning(true);
      loadQueue();
    });
  }, [dictDb, userDb, list?.id]);

  async function loadQueue() {
    if (!dictDb || !userDb || !list || !listId) return;
    setLoading(true);
    translateX.value = 0;

    try {
      if (list.flashcardMode === "add_order") {
        let position = list.studyPosition ?? 0;
        let rows = await userDb.getAllAsync<{ entry_id: number; kanji_literal: string | null }>(
          "SELECT entry_id, kanji_literal FROM list_entries WHERE list_id = ? AND deleted_at IS NULL ORDER BY added_at ASC LIMIT 10 OFFSET ?",
          [listId, position],
        );

        // Wrap around to start if we've passed the end
        if (rows.length === 0 && position > 0) {
          position = 0;
          await userDb.runAsync(
            "UPDATE lists SET study_position = 0, updated_at = ? WHERE id = ?",
            [new Date().toISOString(), listId],
          );
          updateList(listId, { studyPosition: 0, updatedAt: new Date().toISOString() });
          rows = await userDb.getAllAsync<{ entry_id: number; kanji_literal: string | null }>(
            "SELECT entry_id, kanji_literal FROM list_entries WHERE list_id = ? AND deleted_at IS NULL ORDER BY added_at ASC LIMIT 10 OFFSET 0",
            [listId],
          );
        }

        if (rows.length === 0) {
          setCards([]);
          setCursor(0);
          setOriginalCardCount(0);
          setSessionDone(true);
          setLoading(false);
          return;
        }

        type ListEntryRow = { entry_id: number; kanji_literal: string | null };
        const wordIds = rows
          .filter((r: ListEntryRow) => r.kanji_literal == null)
          .map((r: ListEntryRow) => r.entry_id);
        const kanjiLits = rows
          .filter((r: ListEntryRow) => r.kanji_literal != null)
          .map((r: ListEntryRow) => r.kanji_literal!);

        const [wordEntries, kanjiEntries] = await Promise.all([
          wordIds.length > 0 ? getEntries(dictDb, wordIds) : Promise.resolve([]),
          kanjiLits.length > 0 ? getKanjiBatchAsync(dictDb, kanjiLits) : Promise.resolve([]),
        ]);
        const entryMap = new Map(wordEntries.map((e: DictEntry) => [e.id, e]));
        const kanjiMap = new Map(kanjiEntries.map((k: KanjiCharacter) => [k.literal, k]));

        const items: QueueItem[] = [];
        for (const r of rows) {
          if (r.kanji_literal != null) {
            const k = kanjiMap.get(r.kanji_literal);
            if (k) items.push({ kind: "kanji", kanji: k });
          } else {
            const e = entryMap.get(r.entry_id);
            if (e) items.push({ kind: "entry", entry: e });
          }
        }

        setCards(items.map((item) => ({ item, status: "pending" as CardStatus, flipped: false })));
        setCursor(0);
        setOriginalCardCount(items.length);
        setSessionDone(items.length === 0);
      } else if (list.flashcardMode === "simple_srs") {
        // Simple SRS mode: due review cards first, then new cards
        const simpleSrsSelect = `SELECT id, entry_id as entryId, kanji_literal as kanjiLiteral, list_id as listId, due,
          stability, difficulty, elapsed_days as elapsedDays,
          scheduled_days as scheduledDays, reps, lapses, state,
          last_review as lastReview, front_mode as frontMode,
          back_mode as backMode, created_at as createdAt,
          updated_at as updatedAt,
          simple_stage as simpleStage, simple_n as simpleN,
          simple_interval as simpleInterval,
          last_confusion_check as lastConfusionCheck`;

        // Ensure srs_cards exist for all list entries (auto-create if missing)
        const cardCount = await userDb.getFirstAsync<{ c: number }>(
          "SELECT COUNT(*) as c FROM srs_cards WHERE list_id = ? AND deleted_at IS NULL",
          [listId],
        );
        if (!cardCount || cardCount.c === 0) {
          const entryRows = await userDb.getAllAsync<{
            entry_id: number;
            kanji_literal: string | null;
          }>(
            "SELECT entry_id, kanji_literal FROM list_entries WHERE list_id = ? AND deleted_at IS NULL ORDER BY added_at ASC",
            [listId],
          );
          const now = new Date().toISOString();
          for (const row of entryRows) {
            await userDb.runAsync(
              `INSERT INTO srs_cards (id, entry_id, kanji_literal, list_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, front_mode, back_mode, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 'kanji', 'english', ?, ?)`,
              [generateId(), row.entry_id, row.kanji_literal, listId, now, now, now],
            );
          }
        }

        // Load learned/total counts for progress display
        const totalRow = await userDb.getFirstAsync<{ c: number }>(
          "SELECT COUNT(*) as c FROM srs_cards WHERE list_id = ? AND deleted_at IS NULL",
          [listId],
        );
        const learnedRow = await userDb.getFirstAsync<{ c: number }>(
          "SELECT COUNT(*) as c FROM srs_cards WHERE list_id = ? AND simple_stage IS NOT NULL AND deleted_at IS NULL",
          [listId],
        );
        setSimpleSrsTotal(totalRow?.c ?? 0);
        setSimpleSrsLearned(learnedRow?.c ?? 0);

        const nowDays = dateToSrsEpochDays();

        // Due cards: have SRS data and n <= now (n is the due date directly)
        const dueRows = await userDb.getAllAsync<SrsCardRow>(
          `${simpleSrsSelect} FROM srs_cards
           WHERE list_id = ? AND simple_stage IS NOT NULL AND simple_n <= ? AND deleted_at IS NULL
           ORDER BY simple_n ASC`,
          [listId, nowDays],
        );

        // New cards: no SRS data yet (simpleStage IS NULL)
        const newRows = await userDb.getAllAsync<SrsCardRow>(
          `${simpleSrsSelect} FROM srs_cards
           WHERE list_id = ? AND simple_stage IS NULL AND deleted_at IS NULL
           ORDER BY created_at ASC LIMIT ?`,
          [listId, NEW_CARD_BATCH_SIZE],
        );

        const srsRows = [...dueRows, ...newRows];

        if (srsRows.length === 0) {
          setCards([]);
          setCursor(0);
          setOriginalCardCount(0);
          setSessionDone(true);
          setLoading(false);
          return;
        }

        const wordCards = srsRows.filter((r) => r.kanjiLiteral == null);
        const kanjiCards = srsRows.filter((r) => r.kanjiLiteral != null);
        const [wordEntries, kanjiEntries] = await Promise.all([
          wordCards.length > 0
            ? getEntries(
                dictDb,
                wordCards.map((r) => r.entryId),
              )
            : Promise.resolve([]),
          kanjiCards.length > 0
            ? getKanjiBatchAsync(
                dictDb,
                kanjiCards.map((r) => r.kanjiLiteral!),
              )
            : Promise.resolve([]),
        ]);
        const entryMap = new Map(wordEntries.map((e: DictEntry) => [e.id, e]));
        const kanjiMap = new Map(kanjiEntries.map((k: KanjiCharacter) => [k.literal, k]));

        const items: QueueItem[] = [];
        for (const card of srsRows) {
          if (card.kanjiLiteral != null) {
            const k = kanjiMap.get(card.kanjiLiteral);
            if (k) items.push({ kind: "kanji", kanji: k, srsCard: card });
          } else {
            const e = entryMap.get(card.entryId);
            if (e) items.push({ kind: "entry", entry: e, srsCard: card });
          }
        }

        setCards(items.map((item) => ({ item, status: "pending" as CardStatus, flipped: false })));
        setCursor(0);
        setOriginalCardCount(items.length);
        setSessionDone(items.length === 0);
      } else {
        // FSRS mode: reviews first, then a batch of new cards
        const srsSelect = `SELECT id, entry_id as entryId, kanji_literal as kanjiLiteral, list_id as listId, due,
          stability, difficulty, elapsed_days as elapsedDays,
          scheduled_days as scheduledDays, reps, lapses, state,
          last_review as lastReview, front_mode as frontMode,
          back_mode as backMode, created_at as createdAt,
          updated_at as updatedAt,
          simple_stage as simpleStage, simple_n as simpleN,
          simple_interval as simpleInterval,
          last_confusion_check as lastConfusionCheck`;

        const reviewRows = await userDb.getAllAsync<SrsCardRow>(
          `${srsSelect} FROM srs_cards WHERE list_id = ? AND state != 0 AND due <= ? AND deleted_at IS NULL ORDER BY due ASC`,
          [listId, new Date().toISOString()],
        );

        const newRows = await userDb.getAllAsync<SrsCardRow>(
          `${srsSelect} FROM srs_cards WHERE list_id = ? AND state = 0 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT ?`,
          [listId, NEW_CARD_BATCH_SIZE],
        );

        const srsRows = [...reviewRows, ...newRows];

        if (srsRows.length === 0) {
          setCards([]);
          setCursor(0);
          setOriginalCardCount(0);
          setSessionDone(true);
          setLoading(false);
          return;
        }

        const wordCards2 = srsRows.filter((r) => r.kanjiLiteral == null);
        const kanjiCards2 = srsRows.filter((r) => r.kanjiLiteral != null);
        const [wordEntries2, kanjiEntries2] = await Promise.all([
          wordCards2.length > 0
            ? getEntries(
                dictDb,
                wordCards2.map((r) => r.entryId),
              )
            : Promise.resolve([]),
          kanjiCards2.length > 0
            ? getKanjiBatchAsync(
                dictDb,
                kanjiCards2.map((r) => r.kanjiLiteral!),
              )
            : Promise.resolve([]),
        ]);
        const entryMap2 = new Map(wordEntries2.map((e: DictEntry) => [e.id, e]));
        const kanjiMap2 = new Map(kanjiEntries2.map((k: KanjiCharacter) => [k.literal, k]));

        const items: QueueItem[] = [];
        for (const card of srsRows) {
          if (card.kanjiLiteral != null) {
            const k = kanjiMap2.get(card.kanjiLiteral);
            if (k) items.push({ kind: "kanji", kanji: k, srsCard: card });
          } else {
            const e = entryMap2.get(card.entryId);
            if (e) items.push({ kind: "entry", entry: e, srsCard: card });
          }
        }

        setCards(items.map((item) => ({ item, status: "pending" as CardStatus, flipped: false })));
        setCursor(0);
        setOriginalCardCount(items.length);
        setSessionDone(items.length === 0);
      }
    } catch (err) {
      console.error("loadQueue error:", err);
    }
    sessionIdRef.current = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    sessionStartRef.current = new Date().toISOString();
    sessionCorrectRef.current = 0;
    setLoading(false);
  }

  function flashRating(which: "fail" | "pass" | "easy") {
    if (!buttonAnimationEnabled) return;
    const label = which === "fail" ? "Fail" : which === "easy" ? "Easy!" : "Pass";
    const color = which === "fail" ? "#ef4444" : which === "easy" ? "#4ade80" : "#22c55e";
    const ref = which === "fail" ? failButtonRef : passButtonRef;
    ref.current?.measureInWindow((x, y, width, height) => {
      const key = ++floatingKeyRef.current;
      setFloatingRatings((prev) => [...prev, { key, label, color, x: x + width / 2, y: y }]);
    });
  }

  // --- moveCursor: replaces advance/goBack/goForward/advanceFrom ---
  function moveCursor(newCursor: number) {
    setCursor(newCursor);
    setPreSelectedRating(null);
    clearLongPress();
    const targetCard = cardsRef.current[newCursor];
    revealedRef.current = targetCard?.flipped ?? false;
    // Animate translateX
    const target = -(newCursor * slideDistance);
    if (!swipeAnimationEnabled) {
      translateX.value = target;
    } else {
      translateX.value = withTiming(target, slideConfig);
    }
  }

  const hasPrev = cursor > 0;
  const hasNext = currentCard?.status === "rated" && cursor < cards.length - 1;

  async function handleFail(fromReRate = false) {
    flashRating("fail");
    // Cancel voice auto-advance if pending
    if (voiceAutoAdvanceRef.current) {
      clearTimeout(voiceAutoAdvanceRef.current);
      voiceAutoAdvanceRef.current = null;
    }
    if (!fromReRate && isBrowsingHistory) {
      await reRateCard("fail", false);
      return;
    }
    // Read from ref for fresh data (reRateCard may have updated cards before calling us)
    const liveCard = cardsRef.current[cursor];
    if (!liveCard) return;

    const item = liveCard.item;
    const card = item.srsCard;
    const snapshot = card ? captureSnapshot(card) : null;
    let reviewLogId: string | null = null;

    if (list?.flashcardMode === "simple_srs" && card) {
      await rateSimpleSrsCard(card, "fail");
    } else if (list?.flashcardMode === "srs" && card) {
      reviewLogId = generateId();
      await rateSrsCard(card, Rating.Again, reviewLogId);
    }

    // Mark dirty for sync on unmount
    if (!sessionDirtyRef.current) {
      sessionDirtyRef.current = true;
      markDirty();
    }

    // Update current card to rated + append re-queue copy
    const updatedCards = [...cardsRef.current];
    updatedCards[cursor] = {
      ...updatedCards[cursor],
      status: "rated",
      rating: "fail",
      snapshot,
      reviewLogId,
      preStudyPosition: null,
      wasNewSimpleSrs: card ? card.simpleStage == null : false,
    };
    // Push failed card to end for re-review
    updatedCards.push({ item, status: "pending", flipped: false, reQueueOf: cursor });
    cardsRef.current = updatedCards;
    setCards(updatedCards);

    // Log practice event
    if (userDb && listId && item.kind === "entry") {
      const practiceMode = list?.typingMode
        ? "typing_flashcard"
        : list?.voiceMode
          ? "voice"
          : "flashcard";
      const responseMs = revealTimeRef.current > 0 ? Date.now() - revealTimeRef.current : null;
      logPracticeEvent(userDb, {
        entryId: item.entry.id,
        listId,
        practiceMode,
        correct: false,
        responseMs,
        sessionId: sessionIdRef.current,
      }).catch(() => {});
    }

    // Check for confused words (fire-and-forget, modal appears async) -- skip for kanji
    if (card && list?.flashcardMode !== "add_order" && item.kind === "entry") {
      checkForConfusedWords(item.entry, card);
    }

    // Advance to next card
    if (cursor + 1 >= updatedCards.length) {
      loadQueue();
    } else {
      moveCursor(cursor + 1);
    }
  }

  async function handlePass(isLongPress: boolean, fromReRate = false) {
    flashRating(isLongPress ? "easy" : "pass");
    // Cancel voice auto-advance if pending
    if (voiceAutoAdvanceRef.current) {
      clearTimeout(voiceAutoAdvanceRef.current);
      voiceAutoAdvanceRef.current = null;
    }
    if (!fromReRate && isBrowsingHistory) {
      await reRateCard(isLongPress ? "easy" : "pass", isLongPress);
      return;
    }
    // Read from ref for fresh data (reRateCard may have updated cards before calling us)
    const liveCard = cardsRef.current[cursor];
    if (!liveCard) return;

    const item = liveCard.item;
    const card = item.srsCard;
    const snapshot = card ? captureSnapshot(card) : null;
    let reviewLogId: string | null = null;
    let preStudyPosition: number | null = null;
    const wasNewSimpleSrs = card ? card.simpleStage == null : false;
    let shouldReQueue = false;

    if (list?.flashcardMode === "add_order") {
      if (!userDb || !listId) return;
      const currentList = useListsStore.getState().lists.find((l) => l.id === listId);
      preStudyPosition = currentList?.studyPosition ?? 0;
      await userDb.runAsync(
        "UPDATE lists SET study_position = study_position + 1, updated_at = ? WHERE id = ?",
        [new Date().toISOString(), listId],
      );
      if (currentList) {
        updateList(listId, {
          studyPosition: (currentList.studyPosition ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (list?.flashcardMode === "simple_srs" && card) {
      const simpleAction = isLongPress ? "easy" : "pass";
      const graduated = await rateSimpleSrsCard(card, simpleAction as "pass" | "easy");
      if (!graduated) {
        shouldReQueue = true;
      }
    } else if (card) {
      const rating = isLongPress ? Rating.Easy : Rating.Good;
      reviewLogId = generateId();
      await rateSrsCard(card, rating, reviewLogId);
    }

    // Mark dirty for sync on unmount
    if (!sessionDirtyRef.current) {
      sessionDirtyRef.current = true;
      markDirty();
    }

    // Update current card to rated
    const ratingLabel: "pass" | "easy" = isLongPress ? "easy" : "pass";
    const updatedCards = [...cardsRef.current];
    updatedCards[cursor] = {
      ...updatedCards[cursor],
      status: "rated",
      rating: ratingLabel,
      snapshot,
      reviewLogId,
      preStudyPosition,
      wasNewSimpleSrs,
    };
    if (shouldReQueue) {
      updatedCards.push({ item, status: "pending", flipped: false, reQueueOf: cursor });
    }
    cardsRef.current = updatedCards;
    setCards(updatedCards);

    // Log practice event
    if (userDb && listId && item.kind === "entry") {
      const practiceMode = list?.typingMode
        ? "typing_flashcard"
        : list?.voiceMode
          ? "voice"
          : "flashcard";
      const responseMs = revealTimeRef.current > 0 ? Date.now() - revealTimeRef.current : null;
      logPracticeEvent(userDb, {
        entryId: item.entry.id,
        listId,
        practiceMode,
        correct: true,
        responseMs,
        sessionId: sessionIdRef.current,
      }).catch(() => {});
    }

    sessionCorrectRef.current++;
    setReviewedCount((c) => c + 1);

    // Advance
    if (cursor + 1 >= updatedCards.length) {
      loadQueue();
    } else {
      moveCursor(cursor + 1);
    }
  }

  async function rateSrsCard(card: SrsCardRow, rating: Rating, logId?: string) {
    if (!userDb) return;

    const fsrsCard: FsrsCard = {
      due: new Date(card.due),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsedDays,
      scheduled_days: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      last_review: card.lastReview ? new Date(card.lastReview) : undefined,
      learning_steps: 0,
    };

    const result = reviewCard(fsrsCard, rating);
    const updated = result.card;
    const now = new Date().toISOString();

    await userDb.runAsync(
      `UPDATE srs_cards SET
        due = ?, stability = ?, difficulty = ?,
        elapsed_days = ?, scheduled_days = ?,
        reps = ?, lapses = ?, state = ?,
        last_review = ?, updated_at = ?
       WHERE id = ?`,
      [
        updated.due.toISOString(),
        updated.stability,
        updated.difficulty,
        updated.elapsed_days,
        updated.scheduled_days,
        updated.reps,
        updated.lapses,
        updated.state,
        updated.last_review?.toISOString() ?? now,
        now,
        card.id,
      ],
    );

    await userDb.runAsync(
      `INSERT INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId ?? generateId(),
        card.id,
        rating,
        card.state,
        card.due,
        card.stability,
        card.difficulty,
        card.elapsedDays,
        card.scheduledDays,
        now,
      ],
    );
  }

  /**
   * Rate a simple SRS card. Returns true if the card graduated (should advance),
   * false if it stays in learning (should re-queue).
   */
  async function rateSimpleSrsCard(
    card: SrsCardRow,
    action: "pass" | "easy" | "fail",
  ): Promise<boolean> {
    if (!userDb) return true;
    const now = new Date().toISOString();
    const isNew = card.simpleStage == null;
    const isEasy = action === "easy";
    const pass = action !== "fail";

    let updates: { simpleStage: number; simpleN: number; simpleInterval: number };
    let graduated = false;

    if (!pass) {
      // FAIL: preserve interval, reset to learning, increment lapses
      if (isNew) {
        updates = simpleInitCard();
      } else {
        updates = simpleReviewFail(card);
      }
      // Reset correct count for this card
      simpleCorrectCountRef.current.set(card.id, 0);
    } else if (isEasy) {
      // EASY: skip correctCount gate, immediately graduate
      if (isNew) {
        const init = simpleInitCard();
        updates = simpleGraduate({ ...card, ...init }, true, card.lapses > 0);
      } else {
        updates = simpleGraduate(card, true, card.lapses > 0);
      }
      graduated = true;
      simpleCorrectCountRef.current.delete(card.id);
    } else {
      // CORRECT: increment correct count, check if reached graduation threshold
      if (isNew) {
        // First time seeing this card -- initialize and start counting
        updates = simpleInitCard();
        simpleCorrectCountRef.current.set(card.id, 1);
        // Not graduated yet (need 3 correct)
      } else {
        const count = (simpleCorrectCountRef.current.get(card.id) ?? 0) + 1;
        simpleCorrectCountRef.current.set(card.id, count);

        if (count >= SIMPLE_SRS_REQUIRED_CORRECT) {
          // Graduated! Update interval and schedule next review
          updates = simpleGraduate(card, false, card.lapses > 0);
          graduated = true;
          simpleCorrectCountRef.current.delete(card.id);
        } else {
          // Still learning -- keep current state, card will be re-queued
          updates = {
            simpleStage: card.simpleStage ?? 0,
            simpleN: 0, // immediately due
            simpleInterval: card.simpleInterval ?? 0,
          };
        }
      }
    }

    await userDb.runAsync(
      `UPDATE srs_cards SET simple_stage = ?, simple_n = ?, simple_interval = ?,
        reps = reps + 1, lapses = lapses + ?, updated_at = ? WHERE id = ?`,
      [updates.simpleStage, updates.simpleN, updates.simpleInterval, pass ? 0 : 1, now, card.id],
    );

    if (isNew) {
      setSimpleSrsLearned((c) => c + 1);
    }

    return graduated;
  }

  async function checkForConfusedWords(entry: DictEntry, card: SrsCardRow) {
    if (!userDb || !dictDb || !listId) return;
    if (list?.confusionDetection === false) return;
    if (list?.flashcardMode === "add_order") return;

    // Check cooldown: skip if we checked this card recently
    if (card.lastConfusionCheck) {
      const lastCheck = new Date(card.lastConfusionCheck).getTime();
      const cooldownMs = CONFUSION_COOLDOWN_HOURS * 60 * 60 * 1000;
      if (Date.now() - lastCheck < cooldownMs) return;
    }

    // Use post-review reps/lapses (the +1 hasn't been written to the card object yet)
    if (!shouldCheckConfusion(card.reps + 1, card.lapses + 1)) return;

    // Get all entry_ids in the list (excluding the failed one and kanji entries)
    const rows = await userDb.getAllAsync<{ entry_id: number }>(
      "SELECT entry_id FROM list_entries WHERE list_id = ? AND entry_id != ? AND kanji_literal IS NULL AND deleted_at IS NULL",
      [listId, entry.id],
    );
    const entryIds = rows.map((r: { entry_id: number }) => r.entry_id);
    if (entryIds.length === 0) return;

    const results = await findConfusedWords(
      entry,
      entryIds,
      (literal, limit) => getSimilarKanjiAsync(dictDb, literal, limit),
      (ids) => getEntries(dictDb, ids),
    );

    // Record the check timestamp regardless of results
    const now = new Date().toISOString();
    await userDb.runAsync("UPDATE srs_cards SET last_confusion_check = ? WHERE id = ?", [
      now,
      card.id,
    ]);

    if (results.length > 0) {
      setConfusedFailedEntry(entry);
      setConfusedResults(results);
      setConfusedWordsVisible(true);

      // Persist confusion pairs
      for (const result of results) {
        recordConfusion(
          userDb,
          { entryId: entry.id },
          { entryId: result.entry.id },
          "visual_kanji",
          listId,
          "flashcard",
        ).catch(() => {});
      }
    }

    // Meaning-based confusion detection (no reps/lapses gate -- cheap and useful early)
    const listEntries = await getEntries(dictDb, entryIds);
    const meaningResults = findMeaningConfusion(entry, listEntries);
    for (const mr of meaningResults) {
      recordConfusion(
        userDb,
        { entryId: entry.id },
        { entryId: mr.entry.id },
        "meaning",
        listId,
        "flashcard",
      ).catch(() => {});
    }
  }

  async function handleAddConfusedToReview(result: ConfusedWordResult) {
    if (!userDb || !listId) return;

    // Find the srs_card for this confused entry
    const cardRow = await userDb.getFirstAsync<SrsCardRow>(
      `SELECT id, entry_id as entryId, kanji_literal as kanjiLiteral, list_id as listId, due,
        stability, difficulty, elapsed_days as elapsedDays,
        scheduled_days as scheduledDays, reps, lapses, state,
        last_review as lastReview, front_mode as frontMode,
        back_mode as backMode, created_at as createdAt,
        updated_at as updatedAt,
        simple_stage as simpleStage, simple_n as simpleN,
        simple_interval as simpleInterval,
        last_confusion_check as lastConfusionCheck
       FROM srs_cards WHERE list_id = ? AND entry_id = ? AND kanji_literal IS NULL AND deleted_at IS NULL`,
      [listId, result.entry.id],
    );

    if (cardRow) {
      // Fail it so it comes up soon
      if (list?.flashcardMode === "simple_srs") {
        await rateSimpleSrsCard(cardRow, "fail");
      } else if (list?.flashcardMode === "srs") {
        await rateSrsCard(cardRow, Rating.Again);
      }

      // Push to end of current session
      setCards((prev) => [
        ...prev,
        {
          item: { kind: "entry" as const, entry: result.entry as DictEntry, srsCard: cardRow },
          status: "pending" as CardStatus,
          flipped: false,
        },
      ]);
    }
  }

  function clearLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    isLongPressRef.current = false;
    setLongPressActive(false);
  }

  // --- undoSingleCard: undo DB changes for a single StudyCard ---
  async function undoSingleCard(studyCard: StudyCard) {
    if (!userDb || !listId) return;
    const card = studyCard.item.srsCard;
    const snap = studyCard.snapshot;
    const now = new Date().toISOString();

    if (list?.flashcardMode === "srs" && card && snap) {
      // Restore FSRS fields
      await userDb.runAsync(
        `UPDATE srs_cards SET
          due = ?, stability = ?, difficulty = ?,
          elapsed_days = ?, scheduled_days = ?,
          reps = ?, lapses = ?, state = ?,
          last_review = ?, updated_at = ?
         WHERE id = ?`,
        [
          snap.due,
          snap.stability,
          snap.difficulty,
          snap.elapsedDays,
          snap.scheduledDays,
          snap.reps,
          snap.lapses,
          snap.state,
          snap.lastReview,
          now,
          card.id,
        ],
      );
      // Delete review log
      if (studyCard.reviewLogId) {
        await userDb.runAsync("DELETE FROM review_logs WHERE id = ?", [studyCard.reviewLogId]);
      }
    } else if (list?.flashcardMode === "simple_srs" && card && snap) {
      // Restore simple SRS fields
      await userDb.runAsync(
        `UPDATE srs_cards SET simple_stage = ?, simple_n = ?, simple_interval = ?,
          reps = ?, lapses = ?, last_confusion_check = ?, updated_at = ? WHERE id = ?`,
        [
          snap.simpleStage,
          snap.simpleN,
          snap.simpleInterval,
          snap.reps,
          snap.lapses,
          snap.lastConfusionCheck,
          now,
          card.id,
        ],
      );
      // Reset correct count for this card on undo
      simpleCorrectCountRef.current.delete(card.id);
      if (studyCard.wasNewSimpleSrs) {
        setSimpleSrsLearned((c) => Math.max(0, c - 1));
      }
    } else if (list?.flashcardMode === "add_order" && studyCard.preStudyPosition != null) {
      // Restore study_position
      await userDb.runAsync("UPDATE lists SET study_position = ?, updated_at = ? WHERE id = ?", [
        studyCard.preStudyPosition,
        now,
        listId,
      ]);
      updateList(listId, {
        studyPosition: studyCard.preStudyPosition,
        updatedAt: now,
      });
    }

    // Decrement reviewed count for pass/easy
    if (studyCard.rating === "pass" || studyCard.rating === "easy") {
      setReviewedCount((c) => Math.max(0, c - 1));
    }
  }

  // --- reRateCard: replaces reRateFromHistory ---
  async function reRateCard(action: "pass" | "easy" | "fail", isLongPress: boolean) {
    const card = cards[cursor];
    if (!card || card.status !== "rated") return;

    // 1. Undo all rated cards from cursor to end (reverse order)
    for (let i = cards.length - 1; i >= cursor; i--) {
      if (cards[i].status === "rated") {
        await undoSingleCard(cards[i]);
      }
    }

    // 2. Reset cards: cursor -> 'revealed', everything after -> remove re-queue copies + reset to pending
    const next: StudyCard[] = [];
    for (let i = 0; i < cursor; i++) {
      next.push(cards[i]);
    }
    next.push({ item: cards[cursor].item, status: "revealed", flipped: true });
    for (let i = cursor + 1; i < cards.length; i++) {
      if (cards[i].reQueueOf == null) {
        next.push({ item: cards[i].item, status: "pending", flipped: false });
      }
    }
    cardsRef.current = next;
    setCards(next);

    // Update revealedRef since the card is now revealed
    revealedRef.current = true;
    revealTimeRef.current = Date.now();

    // 3. Apply new rating through normal flow (card is now 'revealed' at cursor)
    //    Pass fromReRate=true to skip the isBrowsingHistory check (React state is stale)
    if (action === "fail") {
      await handleFail(true);
    } else {
      await handlePass(isLongPress, true);
    }
  }

  function handlePassPressIn() {
    isLongPressRef.current = false;
    setLongPressActive(false);
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setLongPressActive(true);
    }, 500);
  }

  function handlePassPressOut() {
    // Only clear the timer, not the ref -- onPress reads isLongPressRef after this
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setLongPressActive(false);
  }

  function handlePassPress() {
    const wasLongPress = isLongPressRef.current;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    isLongPressRef.current = false;
    setLongPressActive(false);
    handlePass(wasLongPress);
  }

  function handleGear() {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Options", "Statistics", "Cancel"],
          cancelButtonIndex: 2,
        },
        (index) => {
          if (index === 0) setSettingsVisible(true);
          if (index === 1) setStatsVisible(true);
        },
      );
    } else {
      setMenuVisible(true);
    }
  }

  // --- Carousel measurements ---
  const containerWidth = clampedWidth - 32; // px-4 = 16px each side
  const cardWidth = containerWidth - 2 * CARD_PEEK - 2 * CARD_GAP;
  const slideDistance = cardWidth + CARD_GAP;
  const slideConfig = { duration: SLIDE_DURATION, easing: Easing.out(Easing.ease) };

  // --- Handle card flip (called by StudyCardView via onFlip) ---
  function handleCardFlip() {
    revealedRef.current = true;
    revealTimeRef.current = Date.now();
    // Update card data: set flipped + revealed
    const next = [...cardsRef.current];
    next[cursor] = { ...next[cursor], status: "revealed", flipped: true };
    cardsRef.current = next;
    setCards(next);
    if (list?.autoPlayAudio && audioDb && displayItem && displayItem.kind === "entry") {
      playEntryAudio(audioDb, displayItem.entry.id);
    }
  }

  // --- Voice recognition callback (needs handleCardFlip + handlePass) ---
  voiceCallbackRef.current = (transcript: string) => {
    if (revealed || !displayItem) return;

    // Voice recognition only works for word entries
    if (displayItem.kind !== "entry") return;
    const heard = toHiragana(transcript, { passRomaji: true });
    const readings = displayItem.entry.kana.map((k) => k.text);
    const isCorrect = readings.some((r) => r === heard);

    if (isCorrect) {
      setVoiceStatus("correct");
      setVoiceHeard(null);
      setPreSelectedRating("pass");
      handleCardFlip();
      voiceAutoAdvanceRef.current = setTimeout(() => {
        handlePass(false);
        setVoiceStatus("idle");
      }, 2000);
    } else {
      setVoiceStatus("wrong");
      setVoiceHeard(transcript);
      voiceWrongTimerRef.current = setTimeout(() => {
        setVoiceStatus("idle");
        setVoiceHeard(null);
      }, 1500);
    }
  };

  // --- Gesture handling ---
  const disableSwipe = !swipeAnimationEnabled;
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-15, 15])
        .failOffsetY([-15, 15])
        .onStart(() => {
          gestureStartX.value = translateX.value;
        })
        .onUpdate((e) => {
          const tx = e.translationX;
          if (tx > 0 && !hasPrev) {
            translateX.value = gestureStartX.value + tx * 0.3;
          } else if (tx < 0 && !hasNext) {
            translateX.value = gestureStartX.value + tx * 0.3;
          } else {
            translateX.value = gestureStartX.value + tx;
          }
        })
        .onEnd((e) => {
          const swipeRight =
            hasPrev && (e.translationX > SWIPE_THRESHOLD || e.velocityX > SWIPE_VELOCITY);
          const swipeLeft =
            hasNext && (e.translationX < -SWIPE_THRESHOLD || e.velocityX < -SWIPE_VELOCITY);
          if (swipeRight) {
            const target = gestureStartX.value + slideDistance;
            if (disableSwipe) {
              translateX.value = target;
              runOnJS(moveCursorFromGesture)(cursor - 1);
            } else {
              translateX.value = withTiming(target, slideConfig, () => {
                runOnJS(moveCursorFromGesture)(cursor - 1);
              });
            }
          } else if (swipeLeft) {
            const target = gestureStartX.value - slideDistance;
            if (disableSwipe) {
              translateX.value = target;
              runOnJS(moveCursorFromGesture)(cursor + 1);
            } else {
              translateX.value = withTiming(target, slideConfig, () => {
                runOnJS(moveCursorFromGesture)(cursor + 1);
              });
            }
          } else {
            translateX.value = withTiming(gestureStartX.value, slideConfig);
          }
        }),
    [hasPrev, hasNext, slideDistance, disableSwipe, cursor],
  );

  function handleTapGesture() {
    cursorCardRef.current?.toggle();
  }

  const tapGesture = useMemo(() => Gesture.Tap().onEnd(() => runOnJS(handleTapGesture)()), []);

  const composedGesture = useMemo(
    () => Gesture.Exclusive(panGesture, tapGesture),
    [panGesture, tapGesture],
  );

  // Gesture-triggered cursor move: only updates cursor, no translateX animation
  // (translateX is already handled by the gesture onEnd)
  function moveCursorFromGesture(newCursor: number) {
    setCursor(newCursor);
    setPreSelectedRating(null);
    clearLongPress();
    const targetCard = cardsRef.current[newCursor];
    revealedRef.current = targetCard?.flipped ?? false;
  }

  // --- Animated styles ---
  const rowStyle = useAnimatedStyle(() => ({
    flexDirection: "row" as const,
    alignItems: "stretch" as const,
    transform: [{ translateX: translateX.value }],
  }));

  // Reset carousel position when window resizes (slideDistance changes with screenWidth)
  useEffect(() => {
    translateX.value = -(cursor * slideDistance);
  }, [slideDistance]);

  // --- Sliding window: render cards around cursor so neighbors stay mounted ---
  const WINDOW_RADIUS = 3;
  const windowIndices: number[] = [];
  for (
    let i = Math.max(0, cursor - WINDOW_RADIUS);
    i <= Math.min(cards.length - 1, cursor + WINDOW_RADIUS);
    i++
  ) {
    windowIndices.push(i);
  }

  // --- Card content config ---
  const frontFaces = sortFaces(list?.frontFaces ?? ["kanji"]);
  const backFaces = sortFaces(list?.backFaces ?? ["english"]);

  if (loading) {
    return (
      <CustomHeaderScreen>
        <HeaderPlaceholder py="py-2" spacerHeight={40} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
          <Text className="mt-4 text-muted-foreground">Loading study session...</Text>
        </View>
      </CustomHeaderScreen>
    );
  }

  if (sessionDone) {
    return (
      <CustomHeaderScreen>
        <HeaderPlaceholder py="py-2" spacerHeight={40} />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-4xl mb-4">
            {reviewedCount > 0 ? "All done!" : "Nothing to study!"}
          </Text>
          <Text className="text-lg text-muted-foreground text-center mb-2">
            {reviewedCount > 0
              ? `You reviewed ${reviewedCount} card${reviewedCount === 1 ? "" : "s"}.`
              : list?.flashcardMode === "add_order"
                ? "You've studied all cards in this list. You can reset your position in settings."
                : "No cards are due and no new cards remain."}
          </Text>
          <Button
            className="mt-4"
            label="Return to List"
            variant="outline"
            onPress={() => {
              setNavigating(true);
              setTimeout(() => navigateBack(), 100);
            }}
          />
        </View>
      </CustomHeaderScreen>
    );
  }

  const isSimpleSrs = list?.flashcardMode === "simple_srs";
  const ratedCount = cards.filter((c) => c.status === "rated" && c.reQueueOf == null).length;
  const progress = isSimpleSrs
    ? simpleSrsTotal > 0
      ? (simpleSrsLearned / simpleSrsTotal) * 100
      : 0
    : originalCardCount > 0
      ? (ratedCount / originalCardCount) * 100
      : 0;

  return (
    <CustomHeaderScreen>
      <Banner
        message="Couldn't sync — reviewing with local data"
        severity="warning"
        visible={syncWarning}
        autoDismissMs={4000}
        onDismiss={() => setSyncWarning(false)}
      />
      {/* Header */}
      <View
        className={`flex-row items-center justify-between px-4 py-2 ${Platform.OS === "web" ? "border-b border-border" : ""}`}
        style={webBgStyle}
      >
        <Pressable
          onPress={() => {
            setNavigating(true);
            setTimeout(() => navigateBack(), 100);
          }}
          className="p-2"
        >
          <X size={24} className="text-foreground" />
        </Pressable>
        <Text className="text-sm text-muted-foreground">
          {isBrowsingHistory
            ? `\u2190 ${cursor + 1} / ${cards.length}`
            : isSimpleSrs
              ? `${simpleSrsLearned} / ${simpleSrsTotal}`
              : `${ratedCount + 1} / ${originalCardCount}`}
        </Text>
        <Pressable onPress={handleGear} className="p-2">
          <Settings size={20} className="text-foreground" />
        </Pressable>
      </View>

      {/* Progress bar */}
      <View className="h-1 bg-border mx-4 rounded-full overflow-hidden">
        <View className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
      </View>

      {/* Carousel -- sliding window rendered, scroll via translateX */}
      <GestureDetector gesture={composedGesture}>
        <View className="pt-4" style={{ overflow: "hidden", paddingHorizontal: 16, height: 400 }}>
          <Animated.View
            style={[
              rowStyle,
              {
                marginLeft: CARD_PEEK + CARD_GAP,
                width: cards.length * cardWidth + Math.max(0, cards.length - 1) * CARD_GAP,
                flex: 1,
              },
            ]}
          >
            {windowIndices.map((i) => {
              const studyCard = cards[i];
              if (!studyCard) return null;
              const isCursor = i === cursor;
              return (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: i * (cardWidth + CARD_GAP),
                    width: cardWidth,
                    top: 0,
                    bottom: 0,
                  }}
                >
                  <StudyCardView
                    ref={isCursor ? cursorCardRef : null}
                    item={studyCard.item}
                    status={studyCard.status}
                    initialFlipped={studyCard.flipped}
                    disableFlipAnimation={!flipAnimationEnabled}
                    frontFaces={frontFaces}
                    backFaces={backFaces}
                    flashcardMode={list?.flashcardMode ?? "add_order"}
                    simpleCorrectCount={
                      studyCard.item.srsCard
                        ? (simpleCorrectCountRef.current.get(studyCard.item.srsCard.id) ?? 0)
                        : 0
                    }
                    voiceStatus={isCursor ? voiceStatus : "idle"}
                    voiceHeard={isCursor ? voiceHeard : null}
                    isListening={isCursor && isListening}
                    typingMode={isCursor && !!list?.typingMode}
                    voiceMode={isCursor && !!list?.voiceMode}
                    onFlip={isCursor ? handleCardFlip : () => {}}
                    onTypingComplete={(wasCorrect) => {
                      if (isCursor) {
                        setPreSelectedRating(wasCorrect ? "pass" : "fail");
                      }
                    }}
                    onInfoPress={() =>
                      studyCard.item.kind === "entry"
                        ? router.push(`/lists/word/${studyCard.item.entry.id}`)
                        : tabRouter.pushKanji(studyCard.item.kanji.literal)
                    }
                  />
                </View>
              );
            })}
          </Animated.View>
        </View>
      </GestureDetector>

      {/* Desktop navigation buttons */}
      {Platform.OS === "web" && (
        <View className="flex-row justify-center items-center gap-4 mt-2">
          <Pressable
            onPress={() => hasPrev && moveCursor(cursor - 1)}
            disabled={!hasPrev}
            style={{ opacity: hasPrev ? 1 : 0.3 }}
            className="p-2"
          >
            <ChevronLeft size={24} className="text-foreground" />
          </Pressable>
          <Pressable
            onPress={() => hasNext && moveCursor(cursor + 1)}
            disabled={!hasNext}
            style={{ opacity: hasNext ? 1 : 0.3 }}
            className="p-2"
          >
            <ChevronRight size={24} className="text-foreground" />
          </Pressable>
        </View>
      )}

      {/* Rating buttons -- always visible */}
      {!sessionDone && (
        <View
          className="flex-row gap-3 mt-3"
          style={{ paddingHorizontal: 16 + CARD_PEEK + CARD_GAP }}
        >
          <Pressable
            ref={failButtonRef}
            onPress={() => handleFail()}
            className={`flex-1 items-center justify-center rounded-lg h-12 bg-red-500 ${preSelectedRating === "fail" ? "border-2 border-red-300" : ""}`}
          >
            <Text className="font-medium text-white">
              {preSelectedRating === "fail" ? "Fail \u21B5" : "Fail"}
            </Text>
          </Pressable>
          <Pressable
            ref={passButtonRef}
            onPressIn={handlePassPressIn}
            onPressOut={handlePassPressOut}
            onPress={handlePassPress}
            className={`flex-1 items-center justify-center rounded-lg h-12 ${longPressActive ? "bg-green-400" : "bg-green-500"} ${preSelectedRating === "pass" ? "border-2 border-green-300" : ""}`}
          >
            <Text className="font-medium text-white">
              {longPressActive ? "Easy!" : preSelectedRating === "pass" ? "Pass \u21B5" : "Pass"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Web/Android action sheet menu */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/50" onPress={() => setMenuVisible(false)}>
          <View
            className="mx-4 mb-8 rounded-2xl border border-border bg-background overflow-hidden"
            style={
              Platform.OS === "web"
                ? { maxWidth: 500, width: "100%", alignSelf: "center" }
                : undefined
            }
          >
            <Pressable
              onPress={() => {
                setMenuVisible(false);
                setSettingsVisible(true);
              }}
              className="items-center py-4 border-b border-border"
            >
              <Text className="text-base text-foreground">Options</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuVisible(false);
                setStatsVisible(true);
              }}
              className="items-center py-4 border-b border-border"
            >
              <Text className="text-base text-foreground">Statistics</Text>
            </Pressable>
            <Pressable onPress={() => setMenuVisible(false)} className="items-center py-4">
              <Text className="text-base text-muted-foreground">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Confused words modal */}
      <Modal
        visible={confusedWordsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfusedWordsVisible(false)}
      >
        <View className="flex-1">
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            className="bg-black/50"
            onPress={() => setConfusedWordsVisible(false)}
          />
          <View className="flex-1 justify-center px-6">
            <View
              className="rounded-2xl border border-border bg-background p-5"
              style={
                Platform.OS === "web"
                  ? { maxWidth: 500, width: "100%", alignSelf: "center" }
                  : undefined
              }
            >
              <Text className="text-lg font-semibold text-foreground mb-1">
                Similar words in your list
              </Text>
              <Text className="text-sm text-muted-foreground mb-4">
                You might be confusing these words
              </Text>

              {confusedFailedEntry &&
                confusedResults.map((result, ri) => {
                  const failedKanji = confusedFailedEntry.kanji[0]?.text ?? "";
                  const confusedKanji = result.entry.kanji[0]?.text ?? "";
                  const matchPositions = new Set(result.matches.map((m) => m.position));

                  return (
                    <View key={ri} className="mb-4">
                      {/* Side-by-side comparison */}
                      <View className="flex-row items-center justify-center gap-4 mb-2">
                        {/* Failed word */}
                        <View className="items-center flex-1">
                          <View className="flex-row">
                            {[...failedKanji].map((ch, ci) => (
                              <Text
                                key={ci}
                                className={`text-2xl font-bold ${matchPositions.has(ci) ? "text-red-500" : "text-foreground"}`}
                              >
                                {ch}
                              </Text>
                            ))}
                          </View>
                          <Text className="text-xs text-muted-foreground mt-1">
                            {confusedFailedEntry.kana[0]?.text ?? ""}
                          </Text>
                          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                            {getFaceText(confusedFailedEntry, "english")}
                          </Text>
                        </View>

                        <Text className="text-muted-foreground">vs</Text>

                        {/* Confused word */}
                        <View className="items-center flex-1">
                          <View className="flex-row">
                            {[...confusedKanji].map((ch, ci) => (
                              <Text
                                key={ci}
                                className={`text-2xl font-bold ${matchPositions.has(ci) ? "text-orange-500" : "text-foreground"}`}
                              >
                                {ch}
                              </Text>
                            ))}
                          </View>
                          <Text className="text-xs text-muted-foreground mt-1">
                            {(result.entry as DictEntry).kana?.[0]?.text ?? ""}
                          </Text>
                          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                            {getFaceText(result.entry as DictEntry, "english")}
                          </Text>
                        </View>
                      </View>

                      {/* Match details */}
                      <View className="flex-row flex-wrap justify-center gap-2 mb-2">
                        {result.matches.map((m, mi) => (
                          <View
                            key={mi}
                            className="flex-row items-center bg-muted rounded px-2 py-1"
                          >
                            <Text className="text-sm text-red-500 font-bold">{m.failedKanji}</Text>
                            <Text className="text-xs text-muted-foreground mx-1">{"\u2248"}</Text>
                            <Text className="text-sm text-orange-500 font-bold">
                              {m.candidateKanji}
                            </Text>
                            <Text className="text-xs text-muted-foreground ml-1">
                              {Math.round(m.similarity * 100)}%
                            </Text>
                          </View>
                        ))}
                      </View>

                      <Button
                        variant="outline"
                        label="Add to review"
                        onPress={() => {
                          handleAddConfusedToReview(result);
                          setConfusedResults((prev) => prev.filter((_, i) => i !== ri));
                          if (confusedResults.length <= 1) setConfusedWordsVisible(false);
                        }}
                      />
                    </View>
                  );
                })}

              <Button
                className="mt-1"
                variant="outline"
                label="Dismiss"
                onPress={() => setConfusedWordsVisible(false)}
              />
            </View>
          </View>
        </View>
      </Modal>

      <FlashcardSettingsModal
        visible={settingsVisible}
        onClose={() => {
          setSettingsVisible(false);
          loadQueue();
        }}
        listId={listId!}
      />

      <StudyStatisticsModal
        visible={statsVisible}
        onClose={() => setStatsVisible(false)}
        listId={listId!}
        flashcardMode={list?.flashcardMode ?? "add_order"}
        onClearStatistics={loadQueue}
      />

      {/* Floating rating labels */}
      {floatingRatings.map((fr) => (
        <RatingFloat
          key={fr.key}
          label={fr.label}
          color={fr.color}
          screenX={fr.x}
          screenY={fr.y}
          onDone={() => setFloatingRatings((prev) => prev.filter((r) => r.key !== fr.key))}
        />
      ))}

      {/* Navigation overlay -- covers heavy UI before unmount to prevent frame drops */}
      <NavigatingOverlay visible={navigating} py="py-2" spacerHeight={40} />
    </CustomHeaderScreen>
  );
}
