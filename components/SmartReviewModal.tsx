import React, { useEffect, useState } from "react";
import { Modal, Pressable, Platform, View, ActivityIndicator } from "react-native";
import { useAtom } from "jotai";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useUserDb } from "@/db/user-provider";
import { dayResetHourAtom, smartReviewDaysAtom } from "@/stores/settings";
import {
  countMarkedInWindow,
  getOrCreateSmartList,
  type SmartReviewWindow,
} from "@/lib/smart-review";
import { useRouter } from "expo-router";
import type { WordList } from "@/db/types";

const WINDOW_OPTIONS: SmartReviewWindow[] = [3, 7, 14, 30, null];

function windowLabel(days: SmartReviewWindow): string {
  return days == null ? "All" : `${days}d`;
}

function windowPhrase(days: SmartReviewWindow): string {
  return days == null ? "in total" : `in the last ${days} days`;
}

interface SmartReviewModalProps {
  visible: boolean;
  onClose: () => void;
  sourceList: WordList | undefined;
}

export function SmartReviewModal({ visible, onClose, sourceList }: SmartReviewModalProps) {
  const router = useRouter();
  const userDb = useUserDb();
  const [days, setDays] = useAtom(smartReviewDaysAtom);
  const [resetHour] = useAtom(dayResetHourAtom);
  const [counts, setCounts] = useState<Map<SmartReviewWindow, number> | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!visible || !userDb || !sourceList) return;
    let cancelled = false;
    setCounts(null);
    Promise.all(WINDOW_OPTIONS.map((d) => countMarkedInWindow(userDb, sourceList.id, d, resetHour)))
      .then((ns) => {
        if (!cancelled) setCounts(new Map(WINDOW_OPTIONS.map((d, i) => [d, ns[i]])));
      })
      .catch((err) => {
        console.error("[SmartReview] count failed:", err);
        if (!cancelled) setCounts(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [visible, userDb, sourceList?.id, resetHour]);

  const count = counts ? (counts.get(days) ?? 0) : null;

  async function handleStart() {
    if (!userDb || !sourceList || starting) return;
    setStarting(true);
    try {
      const smartId = await getOrCreateSmartList(userDb, sourceList, days, resetHour);
      onClose();
      router.push(`/lists/study?listId=${smartId}`);
    } catch (err) {
      console.error("[SmartReview] start failed:", err);
    } finally {
      setStarting(false);
    }
  }

  const disabled = count == null || count === 0 || starting;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center px-6 bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}}>
          <View
            className="rounded-2xl border border-border bg-background p-5"
            style={
              Platform.OS === "web"
                ? { maxWidth: 480, width: "100%", alignSelf: "center" }
                : undefined
            }
          >
            <Text className="text-lg font-semibold text-foreground mb-1">Smart Review</Text>
            <Text className="text-sm text-muted-foreground mb-4">
              Review every card you flagged on this list in the window, most-flagged and most-failed
              first. Progress here stays separate from the list.
            </Text>

            <Text className="text-sm font-medium text-muted-foreground mb-2">Lookback window</Text>
            <View className="flex-row gap-2 mb-4">
              {WINDOW_OPTIONS.map((d) => (
                <Pressable
                  key={windowLabel(d)}
                  onPress={() => setDays(d)}
                  className={`flex-1 items-center rounded-lg border py-2 ${
                    days === d ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      days === d ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {windowLabel(d)}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {counts ? (counts.get(d) ?? 0) : "–"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View className="mb-4 flex-row items-center gap-2">
              {count === null ? (
                <>
                  <ActivityIndicator size="small" />
                  <Text className="text-sm text-muted-foreground">Counting flagged cards…</Text>
                </>
              ) : count === 0 ? (
                <Text className="text-sm text-muted-foreground">
                  No flagged cards {windowPhrase(days)}.
                </Text>
              ) : (
                <Text className="text-sm text-foreground">
                  {count} flagged {count === 1 ? "card" : "cards"} {windowPhrase(days)}.
                </Text>
              )}
            </View>

            <View className="flex-row gap-2">
              <Button variant="outline" className="flex-1" label="Cancel" onPress={onClose} />
              <Button
                className="flex-1"
                onPress={handleStart}
                disabled={disabled}
                style={starting ? { opacity: 1 } : undefined}
              >
                <Text className="font-medium text-base text-primary-foreground">
                  {starting ? "Starting…" : "Start"}
                </Text>
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
