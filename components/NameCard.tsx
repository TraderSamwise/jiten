import React from "react";
import { View } from "react-native";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import type { NameEntry } from "@/db/types";

const TYPE_LABELS: Record<string, string> = {
  surname: "Surname",
  given: "Given name",
  fem: "Female name",
  masc: "Male name",
  place: "Place",
  station: "Station",
  organization: "Organization",
  company: "Company",
  product: "Product",
  person: "Person",
  unclass: "Name",
};

function formatType(nameType: string | null): string | null {
  if (!nameType) return null;
  return TYPE_LABELS[nameType] ?? nameType;
}

interface NameCardProps {
  name: NameEntry;
}

export const NameCard = React.memo(function NameCard({ name }: NameCardProps) {
  const typeLabel = formatType(name.nameType);

  return (
    <Card className="mb-2">
      <View className="flex-row items-center gap-2">
        {name.kanji && <Text className="text-lg font-bold text-foreground">{name.kanji}</Text>}
        <Text
          className={`text-sm ${name.kanji ? "text-muted-foreground" : "text-lg font-bold text-foreground"}`}
        >
          {name.kana}
        </Text>
        {typeLabel && (
          <View className="rounded-md bg-secondary px-2 py-0.5">
            <Text className="text-xs text-secondary-foreground">{typeLabel}</Text>
          </View>
        )}
      </View>
      {name.translation && (
        <Text className="mt-1 text-sm text-muted-foreground">{name.translation}</Text>
      )}
    </Card>
  );
});
