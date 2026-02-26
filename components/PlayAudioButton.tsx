import React, { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Volume2 } from "@/lib/icons";
import { useDatabase } from "@/db/provider";
import { playEntryAudio } from "@/lib/audio";

interface PlayAudioButtonProps {
  entryId: number;
  size?: number;
}

export function PlayAudioButton({ entryId, size = 20 }: PlayAudioButtonProps) {
  const { audioDb } = useDatabase();
  const [hasAudio, setHasAudio] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!audioDb) return;
    // Check if audio exists for this entry
    audioDb
      .getFirstAsync<{ c: number }>("SELECT 1 as c FROM word_audio WHERE entry_id = ? LIMIT 1", [
        entryId,
      ])
      .then((row) => setHasAudio(!!row))
      .catch(() => setHasAudio(false));
  }, [audioDb, entryId]);

  if (!hasAudio || !audioDb) return null;

  async function handlePress() {
    if (!audioDb) return;
    setPlaying(true);
    await playEntryAudio(audioDb, entryId);
    // Brief highlight then reset
    setTimeout(() => setPlaying(false), 600);
  }

  return (
    <Pressable onPress={handlePress} hitSlop={8} className="p-1">
      <Volume2 size={size} className={playing ? "text-primary" : "text-muted-foreground"} />
    </Pressable>
  );
}
