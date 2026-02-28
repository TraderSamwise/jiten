import { useState, useCallback, useRef } from "react";
import { useUserDb } from "@/db/user-provider";
import {
  lastUsedListId,
  lastQuickActionEntryId,
  lastQuickActionKanjiLiteral,
  setLastUsedListId,
  setLastQuickActionEntryId,
  setLastQuickActionKanjiLiteral,
  addEntryToList,
  addKanjiToList,
} from "@/lib/quick-bookmark";

export function useQuickBookmark(entryId: number, isBookmarked: boolean) {
  const userDb = useUserDb();
  const [popoverVisible, setPopoverVisible] = useState(false);
  const didAddDuringSession = useRef(false);

  const handlePress = useCallback(async () => {
    if (!userDb || entryId === 0) return;

    // Double-tap on same entry → show modal
    if (lastQuickActionEntryId === entryId) {
      setLastQuickActionEntryId(null);
      didAddDuringSession.current = false;
      setPopoverVisible(true);
      return;
    }

    // First time in session → show modal
    if (lastUsedListId === null) {
      didAddDuringSession.current = false;
      setPopoverVisible(true);
      return;
    }

    if (!isBookmarked) {
      // Quick-add to last-used list
      await addEntryToList(userDb, entryId, lastUsedListId);
      setLastQuickActionEntryId(entryId);
    } else {
      // Already bookmarked → always show modal to unbookmark
      didAddDuringSession.current = false;
      setPopoverVisible(true);
    }
  }, [userDb, entryId, isBookmarked]);

  const handleLongPress = useCallback(() => {
    didAddDuringSession.current = false;
    setPopoverVisible(true);
  }, []);

  const dismissPopover = useCallback(() => {
    setPopoverVisible(false);
    // Only clear saved list if user didn't add during this modal session
    if (!didAddDuringSession.current) {
      setLastUsedListId(null);
    }
    setLastQuickActionEntryId(null);
  }, []);

  const onListToggled = useCallback((listId: string, added: boolean) => {
    if (added) {
      didAddDuringSession.current = true;
      setLastUsedListId(listId);
    } else {
      didAddDuringSession.current = false;
      setLastUsedListId(null);
    }
    setLastQuickActionEntryId(null);
  }, []);

  return { handlePress, handleLongPress, popoverVisible, dismissPopover, onListToggled };
}

export function useQuickBookmarkKanji(kanjiLiteral: string, isBookmarked: boolean) {
  const userDb = useUserDb();
  const [popoverVisible, setPopoverVisible] = useState(false);
  const didAddDuringSession = useRef(false);

  const handlePress = useCallback(async () => {
    if (!userDb || !kanjiLiteral) return;

    // Double-tap on same kanji → show modal
    if (lastQuickActionKanjiLiteral === kanjiLiteral) {
      setLastQuickActionKanjiLiteral(null);
      didAddDuringSession.current = false;
      setPopoverVisible(true);
      return;
    }

    // First time in session → show modal
    if (lastUsedListId === null) {
      didAddDuringSession.current = false;
      setPopoverVisible(true);
      return;
    }

    if (!isBookmarked) {
      // Quick-add to last-used list
      await addKanjiToList(userDb, kanjiLiteral, lastUsedListId);
      setLastQuickActionKanjiLiteral(kanjiLiteral);
    } else {
      // Already bookmarked → always show modal to unbookmark
      didAddDuringSession.current = false;
      setPopoverVisible(true);
    }
  }, [userDb, kanjiLiteral, isBookmarked]);

  const handleLongPress = useCallback(() => {
    didAddDuringSession.current = false;
    setPopoverVisible(true);
  }, []);

  const dismissPopover = useCallback(() => {
    setPopoverVisible(false);
    if (!didAddDuringSession.current) {
      setLastUsedListId(null);
    }
    setLastQuickActionKanjiLiteral(null);
  }, []);

  const onListToggled = useCallback((listId: string, added: boolean) => {
    if (added) {
      didAddDuringSession.current = true;
      setLastUsedListId(listId);
    } else {
      didAddDuringSession.current = false;
      setLastUsedListId(null);
    }
    setLastQuickActionKanjiLiteral(null);
  }, []);

  return { handlePress, handleLongPress, popoverVisible, dismissPopover, onListToggled };
}
