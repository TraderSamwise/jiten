import React, { useMemo } from "react";
import { Text } from "@/components/ui/text";
import { parseMnemonicMarkup } from "@/lib/mnemonic-markup";
import { canonicalStem, targetForPrimitive } from "@/db/primitive-associations";
import type { KanjiPrimitive } from "@/db/types";

interface Props {
  mnemonic: string | null | undefined;
  /** The kanji's own keyword, rendered for {self}. */
  selfKeyword: string | null;
  /** The kanji's decomposition, used to resolve bare [label] references by keyword. */
  primitives: KanjiPrimitive[];
  /** When provided, primitive references are tappable and call this with their target. */
  onNavigate?: (target: string) => void;
  className?: string;
  numberOfLines?: number;
}

/**
 * Renders a mnemonic from the markup language: {self} as the kanji's keyword and
 * [label]/[label](target) primitive references inline, colored and (when onNavigate
 * is given) tappable to deep-link. Returns null when empty so callers can omit the slot.
 */
export function MnemonicText({
  mnemonic,
  selfKeyword,
  primitives,
  onNavigate,
  className = "text-base text-foreground",
  numberOfLines,
}: Props) {
  const nodes = useMemo(() => (mnemonic ? parseMnemonicMarkup(mnemonic) : []), [mnemonic]);

  // Resolve a ref to its navigation target and inline glyph, or null when the label
  // matches none of the kanji's primitives — an unresolved ref renders as plain prose
  // rather than a dead green link.
  const resolveRef = (
    label: string,
    explicitTarget: string | null,
  ): { target: string | null; glyph: string | null } | null => {
    if (explicitTarget) {
      if (!/^p\d+$/.test(explicitTarget)) return { target: explicitTarget, glyph: explicitTarget };
      const byId = primitives.find((p) => targetForPrimitive(p) === explicitTarget);
      return { target: explicitTarget, glyph: byId?.glyph ?? null };
    }
    const stem = canonicalStem(label);
    const match = primitives.find((p) => p.keyword != null && canonicalStem(p.keyword) === stem);
    return match ? { target: targetForPrimitive(match), glyph: match.glyph } : null;
  };

  if (!mnemonic || nodes.length === 0) return null;

  return (
    <Text className={className} numberOfLines={numberOfLines}>
      {nodes.map((node, i) => {
        if (node.type === "text") {
          return <React.Fragment key={i}>{node.value}</React.Fragment>;
        }
        if (node.type === "self") {
          return (
            <Text key={i} className="text-blue-500 font-semibold">
              {selfKeyword ?? ""}
            </Text>
          );
        }
        const resolved = resolveRef(node.label, node.target);
        if (!resolved) {
          // Label matches no primitive (or data not loaded) — render as plain prose.
          return <React.Fragment key={i}>{node.label}</React.Fragment>;
        }
        const onPress =
          onNavigate && resolved.target ? () => onNavigate(resolved.target as string) : undefined;
        const glyph = resolved.glyph && resolved.glyph !== node.label ? resolved.glyph : null;
        return (
          <Text key={i} className="text-green-600" onPress={onPress}>
            {node.label}
            {glyph ? <Text className="text-green-700/70">{` (${glyph})`}</Text> : null}
          </Text>
        );
      })}
    </Text>
  );
}
