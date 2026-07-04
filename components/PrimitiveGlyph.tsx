import React from "react";
import type { StyleProp, TextStyle } from "react-native";
import { Text } from "@/components/ui/text";

/** The bundled font that redraws RTK substitute codepoints as invented-primitive shapes. */
export const RTK_PRIMITIVE_FONT = "RtkPrimitives";

interface Props {
  /** A real Unicode glyph (renders as-is), if the component is a real kanji. */
  glyph?: string | null;
  /** The RTK substitute char for an invented primitive (drawn in the primitive font). */
  displayGlyph?: string | null;
  className?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Renders a primitive's visual form — a real Unicode glyph as-is, or the RTK substitute
 * char in the bundled primitive font. Returns null when there is nothing to draw, so
 * callers pair it with a separate keyword label rather than a fallback here.
 */
export function PrimitiveGlyph({ glyph, displayGlyph, className, style }: Props) {
  if (glyph) {
    return (
      <Text className={className} style={style}>
        {glyph}
      </Text>
    );
  }
  if (displayGlyph) {
    return (
      <Text className={className} style={[{ fontFamily: RTK_PRIMITIVE_FONT }, style]}>
        {displayGlyph}
      </Text>
    );
  }
  return null;
}
