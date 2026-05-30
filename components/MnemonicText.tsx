import React, { useMemo } from "react";
import { Text } from "@/components/ui/text";
import { highlightKeywords } from "@/lib/highlight-keywords";

interface Props {
  mnemonic: string | null | undefined;
  primaryKeywords: string[];
  componentKeywords: string[];
  className?: string;
  numberOfLines?: number;
}

/**
 * Highlighted mnemonic renderer. Returns null when mnemonic is empty so callers
 * can omit the whole layout slot rather than render an empty box.
 */
export function MnemonicText({
  mnemonic,
  primaryKeywords,
  componentKeywords,
  className = "text-base text-foreground",
  numberOfLines,
}: Props) {
  const segments = useMemo(() => {
    if (!mnemonic) return [];
    return highlightKeywords(mnemonic, primaryKeywords, componentKeywords);
  }, [mnemonic, primaryKeywords, componentKeywords]);

  if (!mnemonic || segments.length === 0) return null;

  return (
    <Text className={className} numberOfLines={numberOfLines}>
      {segments.map((seg, i) =>
        seg.type === "plain" ? (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ) : (
          <Text
            key={i}
            className={seg.type === "primary" ? "text-blue-500 font-semibold" : "text-green-600"}
          >
            {seg.text}
          </Text>
        ),
      )}
    </Text>
  );
}
