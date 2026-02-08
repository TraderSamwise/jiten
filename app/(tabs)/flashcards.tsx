import React, { useCallback, useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDatabase } from "@/db/provider";
import { useUserDb } from "@/db/user-provider";
import { getEntry } from "@/db/search";
import { reviewCard, Rating, createNewCard } from "@/stores/srs";
import type { DictEntry, SrsCardRow, CardFace } from "@/db/types";
import type { Card as FsrsCard } from "ts-fsrs";

export default function FlashcardsScreen() {
  const { dictDb, isReady } = useDatabase();
  const userDb = useUserDb();
  const [dueCards, setDueCards] = useState<SrsCardRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [currentEntry, setCurrentEntry] = useState<DictEntry | null>(null);
  const [sessionDone, setSessionDone] = useState(false);

  useEffect(() => {
    if (!isReady || !userDb) return;
    loadDueCards();
  }, [isReady, userDb]);

  async function loadDueCards() {
    if (!userDb) return;
    const rows = await userDb.getAllAsync<SrsCardRow>(
      "SELECT * FROM srs_cards WHERE due <= ? ORDER BY due ASC",
      [new Date().toISOString()]
    );
    setDueCards(rows);
    setCurrentIndex(0);
    setRevealed(false);
    setSessionDone(rows.length === 0);
    if (rows.length > 0 && dictDb) {
      const entry = await getEntry(dictDb, rows[0].entryId);
      setCurrentEntry(entry);
    }
  }

  function getFaceText(entry: DictEntry, mode: CardFace): string {
    switch (mode) {
      case "kanji":
        return entry.kanji[0]?.text ?? entry.kana[0]?.text ?? "";
      case "kana":
        return entry.kana[0]?.text ?? "";
      case "english":
        return (
          entry.senses[0]?.glosses
            .filter((g) => g.lang === "eng")
            .map((g) => g.text)
            .join("; ") ?? ""
        );
    }
  }

  async function handleRate(rating: Rating) {
    if (!dictDb || currentIndex >= dueCards.length) return;

    const card = dueCards[currentIndex];
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
    };

    const result = reviewCard(fsrsCard, rating);
    const updated = result.card;
    const now = new Date().toISOString();

    if (!userDb) return;
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
      ]
    );

    const logId =
      Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    await userDb.runAsync(
      `INSERT INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        card.id,
        rating,
        card.state,
        card.due,
        card.stability,
        card.difficulty,
        card.elapsedDays,
        card.scheduledDays,
        now,
      ]
    );

    const nextIndex = currentIndex + 1;
    if (nextIndex >= dueCards.length) {
      setSessionDone(true);
    } else {
      setCurrentIndex(nextIndex);
      setRevealed(false);
      const entry = await getEntry(dictDb, dueCards[nextIndex].entryId);
      setCurrentEntry(entry);
    }
  }

  if (!isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  if (sessionDone) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-4xl">🎉</Text>
        <Text className="mt-4 text-xl font-semibold text-foreground">
          All caught up!
        </Text>
        <Text className="mt-2 text-center text-muted-foreground">
          No cards due for review. Add words to your lists and create flashcards
          to get started.
        </Text>
        <Button
          className="mt-6"
          label="Refresh"
          variant="outline"
          onPress={loadDueCards}
        />
      </View>
    );
  }

  const currentCard = dueCards[currentIndex];

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <Text className="text-sm text-muted-foreground text-center mb-4">
        {currentIndex + 1} / {dueCards.length} cards
      </Text>

      <Pressable onPress={() => setRevealed(true)} className="flex-1 max-h-96">
        <Card className="flex-1 items-center justify-center">
          {currentEntry && (
            <>
              <Text className="text-3xl font-bold text-foreground">
                {getFaceText(currentEntry, currentCard.frontMode)}
              </Text>

              {revealed && (
                <View className="mt-6 items-center">
                  <View className="h-px w-32 bg-border mb-4" />
                  <Text className="text-xl text-foreground">
                    {getFaceText(currentEntry, currentCard.backMode)}
                  </Text>
                  {currentCard.backMode !== "kana" && currentEntry.kana[0] && (
                    <Text className="mt-2 text-base text-muted-foreground">
                      {currentEntry.kana[0].text}
                    </Text>
                  )}
                </View>
              )}

              {!revealed && (
                <Text className="mt-6 text-sm text-muted-foreground">
                  Tap to reveal
                </Text>
              )}
            </>
          )}
        </Card>
      </Pressable>

      {revealed && (
        <View className="flex-row gap-2 mt-4 mb-8">
          <Button
            className="flex-1 bg-red-500"
            label="Again"
            onPress={() => handleRate(Rating.Again)}
          />
          <Button
            className="flex-1 bg-orange-500"
            label="Hard"
            onPress={() => handleRate(Rating.Hard)}
          />
          <Button
            className="flex-1 bg-green-500"
            label="Good"
            onPress={() => handleRate(Rating.Good)}
          />
          <Button
            className="flex-1 bg-blue-500"
            label="Easy"
            onPress={() => handleRate(Rating.Easy)}
          />
        </View>
      )}
    </View>
  );
}
