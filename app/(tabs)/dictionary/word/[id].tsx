import React, { useEffect, useState } from "react";
import { View, ScrollView, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PitchAccent } from "@/components/PitchAccent";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { getEntry } from "@/db/search";
import { createNewCard } from "@/stores/srs";
import type { DictEntry, WordList } from "@/db/types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function WordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { dictDb, isReady } = useDatabase();
  const userDb = useUserDb();
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [lists, setLists] = useState<WordList[]>([]);

  useEffect(() => {
    if (!dictDb || !isReady || !id) return;
    getEntry(dictDb, Number(id)).then(setEntry);
  }, [dictDb, isReady, id]);

  useEffect(() => {
    if (!userDb) return;
    userDb
      .getAllAsync<WordList>("SELECT * FROM lists ORDER BY name")
      .then(setLists);
  }, [userDb]);

  async function addToList(listId: string) {
    if (!entry || !userDb) return;
    const now = new Date().toISOString();
    const entryExists = await userDb.getFirstAsync<{ id: string }>(
      "SELECT id FROM list_entries WHERE list_id = ? AND entry_id = ?",
      [listId, entry.id]
    );
    if (entryExists) {
      Alert.alert(
        "Already in list",
        "This word is already in the selected list."
      );
      return;
    }
    await userDb.runAsync(
      "INSERT INTO list_entries (id, list_id, entry_id, added_at) VALUES (?, ?, ?, ?)",
      [generateId(), listId, entry.id, now]
    );

    const card = createNewCard();
    const cardId = generateId();
    await userDb.runAsync(
      `INSERT INTO srs_cards (id, entry_id, list_id, due, stability, difficulty,
        elapsed_days, scheduled_days, reps, lapses, state, last_review,
        front_mode, back_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cardId,
        entry.id,
        listId,
        card.due.toISOString(),
        card.stability,
        card.difficulty,
        card.elapsed_days,
        card.scheduled_days,
        card.reps,
        card.lapses,
        card.state,
        card.last_review?.toISOString() ?? null,
        "kanji",
        "english",
        now,
        now,
      ]
    );

    Alert.alert("Added", "Word added to list with a flashcard.");
  }

  if (!entry) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16 }}
    >
      <View className="mb-4">
        {entry.kanji.map((k, i) => (
          <View key={i} className="flex-row items-center gap-2">
            <Text className="text-4xl font-bold text-foreground">{k.text}</Text>
            {k.common && <Badge variant="common" label="common" />}
          </View>
        ))}
        <View className="flex-row flex-wrap gap-2 mt-2">
          {entry.kana.map((k, i) => (
            <View key={i} className="flex-row items-center gap-1">
              <Text className="text-xl text-muted-foreground">{k.text}</Text>
              {k.romaji && (
                <Text className="text-sm text-muted-foreground">
                  ({k.romaji})
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>

      {entry.pitchAccents.length > 0 && (
        <Card className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-2">
            Pitch Accent
          </Text>
          {entry.pitchAccents.map((pa, i) => (
            <PitchAccent key={i} accent={pa} />
          ))}
        </Card>
      )}

      <Card className="mb-4">
        <Text className="text-sm font-semibold text-foreground mb-2">
          Meanings
        </Text>
        {entry.senses.map((sense, i) => (
          <View key={i} className="mb-3">
            {sense.partOfSpeech.length > 0 && (
              <View className="flex-row flex-wrap gap-1 mb-1">
                {sense.partOfSpeech.map((pos, j) => (
                  <Badge key={j} variant="secondary" label={pos} />
                ))}
              </View>
            )}
            <Text className="text-base text-foreground">
              {i + 1}.{" "}
              {sense.glosses
                .filter((g) => g.lang === "eng")
                .map((g) => g.text)
                .join("; ")}
            </Text>
            {sense.field && (
              <Text className="text-xs text-muted-foreground italic">
                Field: {sense.field}
              </Text>
            )}
            {sense.info && (
              <Text className="text-xs text-muted-foreground">
                {sense.info}
              </Text>
            )}
          </View>
        ))}
      </Card>

      {lists.length > 0 && (
        <Card className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-2">
            Add to List
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {lists.map((list) => (
              <Button
                key={list.id}
                variant="outline"
                size="sm"
                label={list.name}
                onPress={() => addToList(list.id)}
              />
            ))}
          </View>
        </Card>
      )}
    </ScrollView>
  );
}
