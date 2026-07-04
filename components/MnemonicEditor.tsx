import React, { useMemo, useRef, useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  Platform,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
  type TextInputKeyPressEventData,
} from "react-native";
import { Text } from "@/components/ui/text";
import { PrimitiveGlyph } from "@/components/PrimitiveGlyph";
import type { KanjiPrimitive } from "@/db/types";
import { useMnemonicSuggestor } from "@/hooks/useMnemonicSuggestor";
import {
  wrapAsRef,
  completeBracket,
  unlinkedPrimitives,
  type PrimitiveChoice,
} from "@/lib/mnemonic-suggestor";

interface Props {
  literal: string;
  initialValue: string;
  primitives: KanjiPrimitive[];
  onSave: (text: string) => void;
  autoFocus?: boolean;
}

/**
 * The mnemonic editing surface: a raw-markup TextInput augmented with the suggestor —
 * a [-triggered primitive dropdown, an ambient link suggestion chip (tap/Tab to accept,
 * ✕ to suppress for the session), and an "not yet linked" nudge bar.
 */
export function MnemonicEditor({ literal, initialValue, primitives, onSave, autoFocus }: Props) {
  const [text, setText] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);
  // A forced selection is applied right after a transform (to move the cursor), then
  // released to undefined on the next selection change so the user keeps cursor control.
  const [forcedSelection, setForcedSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);
  const inputRef = useRef<TextInput>(null);
  // Tapping a suggestion blurs the input; this tells onBlur to refocus instead of save.
  const skipBlurSave = useRef(false);

  const { ambient, dropdown, suppress } = useMnemonicSuggestor(literal, text, cursor, primitives);
  const unlinked = useMemo(() => unlinkedPrimitives(text, primitives), [text, primitives]);

  const applyTransform = (result: { text: string; cursor: number }) => {
    // Clear here too: on native a suggestion tap often doesn't blur the input, so the
    // holdFocus flag would otherwise stick and swallow the next genuine blur-to-save.
    skipBlurSave.current = false;
    inputRef.current?.focus();
    // A stale span makes the transform a no-op; don't yank the cursor in that case.
    if (result.text === text) return;
    setForcedSelection({ start: result.cursor, end: result.cursor });
    setText(result.text);
    setCursor(result.cursor);
  };

  const acceptAmbient = () => {
    if (ambient) applyTransform(wrapAsRef(text, ambient.span, ambient.candidate.target));
  };
  const acceptDropdown = (choice: PrimitiveChoice) => {
    if (dropdown)
      applyTransform(completeBracket(text, dropdown.start, cursor, choice.keyword, choice.target));
  };
  const dismissAmbient = () => {
    if (ambient) {
      skipBlurSave.current = false;
      suppress(ambient.span.text);
      inputRef.current?.focus();
    }
  };

  const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    setForcedSelection(undefined);
    setCursor(e.nativeEvent.selection.start);
  };

  const onBlur = () => {
    if (skipBlurSave.current) {
      skipBlurSave.current = false;
      inputRef.current?.focus();
      return;
    }
    onSave(text);
  };

  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS === "web" && e.nativeEvent.key === "Tab" && ambient) {
      (e as unknown as { preventDefault?: () => void }).preventDefault?.();
      acceptAmbient();
    }
  };

  const holdFocus = () => {
    skipBlurSave.current = true;
  };

  return (
    <View className="gap-2">
      {/* Suggestions sit above the input so the on-screen keyboard can't hide them. */}
      {unlinked.length > 0 && (
        <View className="flex-row items-center gap-1 flex-wrap">
          <Text className="text-xs text-muted-foreground">Not yet linked:</Text>
          {unlinked.map((p) => (
            <View
              key={p.position}
              className="flex-row items-center gap-1 rounded-full bg-secondary px-2 py-0.5"
            >
              <PrimitiveGlyph
                glyph={p.glyph}
                displayGlyph={p.displayGlyph}
                className="text-xs text-foreground"
              />
              <Text className="text-xs text-muted-foreground">{p.keyword}</Text>
            </View>
          ))}
        </View>
      )}

      {dropdown && dropdown.candidates.length > 0 && (
        <View className="border border-border rounded-lg overflow-hidden">
          {dropdown.candidates.map((choice) => (
            <Pressable
              key={choice.target}
              onPressIn={holdFocus}
              onPress={() => acceptDropdown(choice)}
              className="px-3 py-2 border-b border-border/40"
            >
              <Text className="text-sm text-foreground">
                {choice.keyword}
                <Text className="text-xs text-muted-foreground">
                  {" → "}
                  {choice.glyph != null || choice.displayGlyph != null ? (
                    <PrimitiveGlyph
                      glyph={choice.glyph}
                      displayGlyph={choice.displayGlyph}
                      className="text-xs text-muted-foreground"
                    />
                  ) : (
                    choice.target
                  )}
                </Text>
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {ambient && (
        <View className="flex-row items-center gap-2 flex-wrap">
          <Pressable
            onPressIn={holdFocus}
            onPress={acceptAmbient}
            className="bg-green-600/15 rounded-full px-3 py-1"
          >
            <Text className="text-sm text-green-700">
              Link “{ambient.span.text}” → {ambient.candidate.keyword ?? ambient.candidate.target}
            </Text>
          </Pressable>
          <Pressable onPressIn={holdFocus} onPress={dismissAmbient} className="px-2 py-1">
            <Text className="text-sm text-muted-foreground">✕</Text>
          </Pressable>
        </View>
      )}

      <TextInput
        ref={inputRef}
        className="text-base text-foreground bg-secondary/50 rounded-lg p-3 min-h-[80px]"
        value={text}
        onChangeText={setText}
        selection={forcedSelection}
        onSelectionChange={onSelectionChange}
        onKeyPress={onKeyPress}
        multiline
        textAlignVertical="top"
        placeholder="Write your mnemonic story..."
        placeholderTextColor="#999"
        autoFocus={autoFocus}
        onBlur={onBlur}
      />

      {primitives.length > 0 && (
        <Text className="text-xs text-muted-foreground/70">
          Tip: type “[” to link a primitive, or tap a green suggestion above.
        </Text>
      )}
    </View>
  );
}
