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

  const resolveBareTarget = (label: string): string | null => {
    const stem = canonicalStem(label);
    const match = primitives.find((p) => p.keyword != null && canonicalStem(p.keyword) === stem);
    return match ? targetForPrimitive(match) : null;
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
        const target = node.target ?? resolveBareTarget(node.label);
        const onPress = onNavigate && target ? () => onNavigate(target) : undefined;
        return (
          <Text key={i} className="text-green-600" onPress={onPress}>
            {node.label}
          </Text>
        );
      })}
    </Text>
  );
}
