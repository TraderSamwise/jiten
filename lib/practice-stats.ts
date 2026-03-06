import type { WrappedUserDb } from "@/db/user-db";

export interface LeechCard {
  entryId: number;
  kanjiLiteral: string | null;
  totalAttempts: number;
  correctCount: number;
  accuracy: number;
}

export async function getLeechCards(
  userDb: WrappedUserDb,
  listId: string,
  minAttempts: number = 10,
  maxAccuracy: number = 0.5,
): Promise<LeechCard[]> {
  return userDb.getAllAsync<LeechCard>(
    `SELECT entry_id as entryId, kanji_literal as kanjiLiteral,
            COUNT(*) as totalAttempts,
            SUM(correct) as correctCount,
            CAST(SUM(correct) AS REAL) / COUNT(*) as accuracy
     FROM (
       SELECT entry_id, kanji_literal, correct FROM practice_events WHERE list_id = ?
       UNION ALL
       SELECT sc.entry_id, sc.kanji_literal, CASE WHEN rl.rating > 1 THEN 1 ELSE 0 END as correct
       FROM review_logs rl
       JOIN srs_cards sc ON sc.id = rl.card_id AND sc.deleted_at IS NULL
       WHERE sc.list_id = ?
     )
     GROUP BY entry_id, kanji_literal
     HAVING totalAttempts >= ? AND accuracy < ?
     ORDER BY accuracy ASC`,
    [listId, listId, minAttempts, maxAccuracy],
  );
}

export async function getLapseBasedLeeches(
  userDb: WrappedUserDb,
  listId: string,
  minLapses: number = 8,
) {
  return userDb.getAllAsync<{ entryId: number; kanjiLiteral: string | null; lapses: number }>(
    `SELECT entry_id as entryId, kanji_literal as kanjiLiteral, lapses
     FROM srs_cards WHERE list_id = ? AND lapses >= ? AND deleted_at IS NULL
     ORDER BY lapses DESC`,
    [listId, minLapses],
  );
}

export async function getEntryPracticeStats(userDb: WrappedUserDb, entryId: number) {
  const row = await userDb.getFirstAsync<{
    total: number;
    correct: number;
    accuracy: number;
    lastPracticed: string | null;
  }>(
    `SELECT COUNT(*) as total,
            SUM(correct) as correct,
            CASE WHEN COUNT(*) > 0 THEN CAST(SUM(correct) AS REAL) / COUNT(*) ELSE 0 END as accuracy,
            MAX(reviewed_at) as lastPracticed
     FROM (
       SELECT correct, reviewed_at FROM practice_events WHERE entry_id = ?
       UNION ALL
       SELECT CASE WHEN rl.rating > 1 THEN 1 ELSE 0 END, rl.reviewed_at
       FROM review_logs rl
       JOIN srs_cards sc ON sc.id = rl.card_id AND sc.deleted_at IS NULL
       WHERE sc.entry_id = ?
     )`,
    [entryId, entryId],
  );
  return row ?? { total: 0, correct: 0, accuracy: 0, lastPracticed: null };
}

// ─── Daily Activity (for heatmap) ───

export interface DailyActivity {
  day: string;
  reviews: number;
  correct: number;
  timeMs: number;
}

export async function getDailyActivity(
  userDb: WrappedUserDb,
  listId?: string | null,
  days: number = 90,
): Promise<DailyActivity[]> {
  const params: any[] = [days];
  let where = "";
  if (listId) {
    where = "AND list_id = ?";
    params.push(listId);
  }
  return userDb.getAllAsync<DailyActivity>(
    `SELECT DATE(reviewed_at) as day, COUNT(*) as reviews, SUM(correct) as correct,
            COALESCE(SUM(response_ms), 0) as timeMs
     FROM practice_events
     WHERE reviewed_at >= date('now', '-' || ? || ' days') ${where}
     GROUP BY day ORDER BY day`,
    params,
  );
}

// ─── Recent Sessions ───

export interface SessionSummary {
  sessionId: string;
  listId: string | null;
  practiceMode: string;
  startedAt: string;
  durationMs: number;
  totalItems: number;
  correctCount: number;
}

export async function getRecentSessions(
  userDb: WrappedUserDb,
  listId?: string | null,
  limit: number = 20,
): Promise<SessionSummary[]> {
  if (listId) {
    return userDb.getAllAsync<SessionSummary>(
      `SELECT session_id as sessionId, list_id as listId, practice_mode as practiceMode,
              started_at as startedAt, duration_ms as durationMs, total_items as totalItems,
              correct_count as correctCount
       FROM practice_sessions WHERE list_id = ? ORDER BY started_at DESC LIMIT ?`,
      [listId, limit],
    );
  }
  return userDb.getAllAsync<SessionSummary>(
    `SELECT session_id as sessionId, list_id as listId, practice_mode as practiceMode,
            started_at as startedAt, duration_ms as durationMs, total_items as totalItems,
            correct_count as correctCount
     FROM practice_sessions ORDER BY started_at DESC LIMIT ?`,
    [limit],
  );
}

// ─── Top Confusion Pairs ───

export interface ConfusionPairResult {
  entryIdA: number;
  entryIdB: number;
  kanjiLiteralA: string | null;
  kanjiLiteralB: string | null;
  confusionType: string;
  confusionCount: number;
  lastConfusedAt: string;
}

export async function getTopConfusionPairs(
  userDb: WrappedUserDb,
  listId?: string | null,
  limit: number = 10,
): Promise<ConfusionPairResult[]> {
  if (listId) {
    return userDb.getAllAsync<ConfusionPairResult>(
      `SELECT cp.entry_id_a as entryIdA, cp.entry_id_b as entryIdB,
              cp.kanji_literal_a as kanjiLiteralA, cp.kanji_literal_b as kanjiLiteralB,
              cp.confusion_type as confusionType, cp.confusion_count as confusionCount,
              cp.last_confused_at as lastConfusedAt
       FROM confusion_pairs cp
       WHERE cp.deleted_at IS NULL AND (cp.entry_id_a IN (SELECT entry_id FROM list_entries WHERE list_id = ? AND deleted_at IS NULL)
          OR cp.entry_id_b IN (SELECT entry_id FROM list_entries WHERE list_id = ? AND deleted_at IS NULL))
       ORDER BY cp.confusion_count DESC LIMIT ?`,
      [listId, listId, limit],
    );
  }
  return userDb.getAllAsync<ConfusionPairResult>(
    `SELECT entry_id_a as entryIdA, entry_id_b as entryIdB,
            kanji_literal_a as kanjiLiteralA, kanji_literal_b as kanjiLiteralB,
            confusion_type as confusionType, confusion_count as confusionCount,
            last_confused_at as lastConfusedAt
     FROM confusion_pairs WHERE deleted_at IS NULL ORDER BY confusion_count DESC LIMIT ?`,
    [limit],
  );
}

// ─── Card State Distribution ───

export interface CardDistribution {
  newCount: number;
  learning: number;
  review: number;
  relearning: number;
  total: number;
}

export async function getCardStateDistribution(
  userDb: WrappedUserDb,
  listId: string,
): Promise<CardDistribution> {
  // srs_cards.state: 0=new, 1=learning, 2=review, 3=relearning
  const rows = await userDb.getAllAsync<{ state: number; cnt: number }>(
    `SELECT state, COUNT(*) as cnt FROM srs_cards WHERE list_id = ? AND deleted_at IS NULL GROUP BY state`,
    [listId],
  );
  const totalEntries = await userDb.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM list_entries WHERE list_id = ? AND deleted_at IS NULL`,
    [listId],
  );
  const stateMap = new Map(rows.map((r) => [r.state, r.cnt]));
  const srsTotal = rows.reduce((sum, r) => sum + r.cnt, 0);
  const total = totalEntries?.cnt ?? 0;
  return {
    newCount: Math.max(0, total - srsTotal),
    learning: stateMap.get(1) ?? 0,
    review: stateMap.get(2) ?? 0,
    relearning: stateMap.get(3) ?? 0,
    total,
  };
}

// ─── Today's Summary ───

export interface TodaySummary {
  reviews: number;
  correct: number;
  accuracy: number;
  timeMs: number;
  sessions: number;
}

export async function getTodaySummary(
  userDb: WrappedUserDb,
  listId?: string | null,
): Promise<TodaySummary> {
  const listFilter = listId ? "AND list_id = ?" : "";
  const params = listId ? [listId] : [];

  const events = await userDb.getFirstAsync<{ reviews: number; correct: number; timeMs: number }>(
    `SELECT COUNT(*) as reviews, COALESCE(SUM(correct), 0) as correct,
            COALESCE(SUM(response_ms), 0) as timeMs
     FROM practice_events
     WHERE DATE(reviewed_at) = DATE('now') ${listFilter}`,
    params,
  );

  const sess = await userDb.getFirstAsync<{ sessions: number }>(
    `SELECT COUNT(*) as sessions FROM practice_sessions
     WHERE DATE(started_at) = DATE('now') ${listFilter}`,
    params,
  );

  const reviews = events?.reviews ?? 0;
  const correct = events?.correct ?? 0;
  return {
    reviews,
    correct,
    accuracy: reviews > 0 ? correct / reviews : 0,
    timeMs: events?.timeMs ?? 0,
    sessions: sess?.sessions ?? 0,
  };
}

// ─── Streak ───

export interface StreakInfo {
  current: number;
  longest: number;
}

export async function getCurrentStreak(
  userDb: WrappedUserDb,
  listId?: string | null,
): Promise<StreakInfo> {
  const listFilter = listId ? "WHERE list_id = ?" : "";
  const params = listId ? [listId] : [];

  const days = await userDb.getAllAsync<{ day: string }>(
    `SELECT DISTINCT DATE(reviewed_at) as day FROM practice_events ${listFilter} ORDER BY day DESC`,
    params,
  );

  if (days.length === 0) return { current: 0, longest: 0 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  let current = 0;
  let longest = 0;
  let streak = 0;
  let expectedDate = new Date(today);

  // If neither today nor yesterday has activity, current streak is 0
  const firstDay = days[0]?.day;
  if (firstDay !== todayStr && firstDay !== yesterdayStr) {
    for (let i = 0; i < days.length; i++) {
      if (i === 0) {
        streak = 1;
        continue;
      }
      const prev = new Date(days[i - 1].day);
      const curr = new Date(days[i].day);
      const diff = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        streak++;
      } else {
        longest = Math.max(longest, streak);
        streak = 1;
      }
    }
    longest = Math.max(longest, streak);
    return { current: 0, longest };
  }

  // Walk from most recent day backwards
  for (let i = 0; i < days.length; i++) {
    const dayDate = new Date(days[i].day + "T00:00:00");
    if (i === 0) {
      expectedDate = dayDate;
      streak = 1;
      continue;
    }
    expectedDate.setDate(expectedDate.getDate() - 1);
    if (days[i].day === expectedDate.toISOString().slice(0, 10)) {
      streak++;
    } else {
      if (current === 0) current = streak;
      longest = Math.max(longest, streak);
      streak = 1;
      expectedDate = dayDate;
    }
  }
  if (current === 0) current = streak;
  longest = Math.max(longest, streak);
  return { current, longest };
}

// ─── Day Review Events ───

export interface DayReviewEvent {
  entryId: number;
  kanjiLiteral: string | null;
  sessionId: string | null;
  practiceMode: string;
  correct: number;
  assisted: number;
  responseMs: number | null;
  typedAnswer: string | null;
  reviewedAt: string;
}

export async function getDayReviewEvents(
  userDb: WrappedUserDb,
  day: string,
  listId?: string | null,
): Promise<DayReviewEvent[]> {
  const listFilter = listId ? "AND list_id = ?" : "";
  const params: any[] = [day, ...(listId ? [listId] : [])];
  return userDb.getAllAsync<DayReviewEvent>(
    `SELECT entry_id as entryId, kanji_literal as kanjiLiteral,
            session_id as sessionId, practice_mode as practiceMode,
            correct, COALESCE(assisted, 0) as assisted,
            response_ms as responseMs, typed_answer as typedAnswer,
            reviewed_at as reviewedAt
     FROM practice_events
     WHERE DATE(reviewed_at) = ? ${listFilter}
     ORDER BY reviewed_at ASC`,
    params,
  );
}

// ─── Day Sessions With Grouped Entries ───

export interface DayEntryResult {
  entryId: number;
  kanjiLiteral: string | null;
  attempts: number;
  correctCount: number;
  assisted: boolean;
  avgResponseMs: number | null;
  lastTypedAnswer: string | null;
  correct: boolean;
}

export interface DaySessionDetail {
  sessionId: string | null;
  practiceMode: string;
  startedAt: string | null;
  durationMs: number | null;
  totalItems: number;
  correctCount: number;
  entries: DayEntryResult[];
}

export async function getDaySessionsWithEvents(
  userDb: WrappedUserDb,
  day: string,
  listId?: string | null,
): Promise<DaySessionDetail[]> {
  const events = await getDayReviewEvents(userDb, day, listId);
  if (events.length === 0) return [];

  // Fetch session summaries for this day
  const listFilter = listId ? "AND list_id = ?" : "";
  const sessParams: any[] = [day, ...(listId ? [listId] : [])];
  const sessionRows = await userDb.getAllAsync<SessionSummary>(
    `SELECT session_id as sessionId, list_id as listId, practice_mode as practiceMode,
            started_at as startedAt, duration_ms as durationMs, total_items as totalItems,
            correct_count as correctCount
     FROM practice_sessions
     WHERE DATE(started_at) = ? ${listFilter}
     ORDER BY started_at ASC`,
    sessParams,
  );
  const sessionMap = new Map(sessionRows.map((s) => [s.sessionId, s]));

  // Group events by session_id
  const eventsBySession = new Map<string, DayReviewEvent[]>();
  for (const ev of events) {
    const key = ev.sessionId ?? "__ungrouped__";
    if (!eventsBySession.has(key)) eventsBySession.set(key, []);
    eventsBySession.get(key)!.push(ev);
  }

  const results: DaySessionDetail[] = [];

  for (const [sessKey, sessEvents] of eventsBySession) {
    const sessInfo = sessKey !== "__ungrouped__" ? sessionMap.get(sessKey) : undefined;

    // Aggregate per-entry
    const entryMap = new Map<string, { events: DayReviewEvent[] }>();
    for (const ev of sessEvents) {
      const eKey = ev.kanjiLiteral ? `k:${ev.kanjiLiteral}` : `e:${ev.entryId}`;
      if (!entryMap.has(eKey)) entryMap.set(eKey, { events: [] });
      entryMap.get(eKey)!.events.push(ev);
    }

    const entries: DayEntryResult[] = [];
    for (const { events: evs } of entryMap.values()) {
      const first = evs[0];
      const attempts = evs.length;
      const correctCount = evs.filter((e) => e.correct).length;
      const responseTimes = evs.map((e) => e.responseMs).filter((ms): ms is number => ms != null);
      const avgResponseMs =
        responseTimes.length > 0
          ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
          : null;
      const failedEvs = evs.filter((e) => !e.correct && e.typedAnswer);
      const lastTypedAnswer =
        failedEvs.length > 0 ? failedEvs[failedEvs.length - 1].typedAnswer : null;

      const wasAssisted = evs.some((e) => e.assisted);

      entries.push({
        entryId: first.entryId,
        kanjiLiteral: first.kanjiLiteral,
        attempts,
        correctCount,
        assisted: wasAssisted,
        avgResponseMs,
        lastTypedAnswer,
        correct: correctCount === attempts,
      });
    }

    const totalCorrect = sessEvents.filter((e) => e.correct).length;

    results.push({
      sessionId: sessKey === "__ungrouped__" ? null : sessKey,
      practiceMode: sessInfo?.practiceMode ?? sessEvents[0]?.practiceMode ?? "flashcard",
      startedAt: sessInfo?.startedAt ?? sessEvents[0]?.reviewedAt ?? null,
      durationMs: sessInfo?.durationMs ?? null,
      totalItems: sessEvents.length,
      correctCount: totalCorrect,
      entries,
    });
  }

  // Sort by startedAt descending (most recent first)
  results.sort((a, b) => {
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return b.startedAt.localeCompare(a.startedAt);
  });

  return results;
}

// ─── Temporal Confusion Events ───

export interface ConfusionEventResult {
  entryIdA: number;
  kanjiLiteralA: string | null;
  entryIdB: number;
  kanjiLiteralB: string | null;
  confusionType: string;
  listId: string | null;
  practiceMode: string | null;
  confusedAt: string;
}

export async function getConfusionEventsForDay(
  userDb: WrappedUserDb,
  day: string,
  listId?: string | null,
): Promise<ConfusionEventResult[]> {
  const listFilter = listId ? "AND list_id = ?" : "";
  const params: any[] = [day, ...(listId ? [listId] : [])];
  return userDb.getAllAsync<ConfusionEventResult>(
    `SELECT entry_id_a as entryIdA, kanji_literal_a as kanjiLiteralA,
            entry_id_b as entryIdB, kanji_literal_b as kanjiLiteralB,
            confusion_type as confusionType, list_id as listId,
            practice_mode as practiceMode, confused_at as confusedAt
     FROM confusion_events
     WHERE DATE(confused_at) = ? ${listFilter}
     ORDER BY confused_at ASC`,
    params,
  );
}

export async function buildDayConfusionClusters(
  userDb: WrappedUserDb,
  day: string,
  listId?: string | null,
): Promise<ConfusionCluster[]> {
  const events = await getConfusionEventsForDay(userDb, day, listId);
  if (events.length === 0) return [];

  // Deduplicate events into pair-like structures for buildConfusionClusters
  const pairMap = new Map<string, ConfusionPairResult>();
  for (const ev of events) {
    const key = `${ev.entryIdA}:${ev.kanjiLiteralA}:${ev.entryIdB}:${ev.kanjiLiteralB}:${ev.confusionType}`;
    const existing = pairMap.get(key);
    if (existing) {
      existing.confusionCount++;
      existing.lastConfusedAt = ev.confusedAt;
    } else {
      pairMap.set(key, {
        entryIdA: ev.entryIdA,
        entryIdB: ev.entryIdB,
        kanjiLiteralA: ev.kanjiLiteralA,
        kanjiLiteralB: ev.kanjiLiteralB,
        confusionType: ev.confusionType,
        confusionCount: 1,
        lastConfusedAt: ev.confusedAt,
      });
    }
  }

  return buildConfusionClusters([...pairMap.values()]);
}

// ─── Confusion Clusters (Union-Find) ───

export interface ConfusionCluster {
  entries: { entryId: number; kanjiLiteral: string | null }[];
  pairs: ConfusionPairResult[];
  totalConfusions: number;
  dominantType: string;
}

export function buildConfusionClusters(pairs: ConfusionPairResult[]): ConfusionCluster[] {
  if (pairs.length === 0) return [];

  const parent = new Map<string, string>();

  function key(entryId: number, kanjiLiteral: string | null): string {
    return kanjiLiteral ? `k:${kanjiLiteral}` : `e:${entryId}`;
  }

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  function parseKey(k: string): { entryId: number; kanjiLiteral: string | null } {
    if (k.startsWith("k:")) return { entryId: 0, kanjiLiteral: k.slice(2) };
    return { entryId: parseInt(k.slice(2), 10), kanjiLiteral: null };
  }

  // Build unions
  for (const pair of pairs) {
    const ka = key(pair.entryIdA, pair.kanjiLiteralA);
    const kb = key(pair.entryIdB, pair.kanjiLiteralB);
    union(ka, kb);
  }

  // Group by root
  const clusterMap = new Map<
    string,
    {
      entries: Set<string>;
      pairs: ConfusionPairResult[];
      total: number;
      types: Map<string, number>;
    }
  >();

  for (const pair of pairs) {
    const ka = key(pair.entryIdA, pair.kanjiLiteralA);
    const kb = key(pair.entryIdB, pair.kanjiLiteralB);
    const root = find(ka);
    if (!clusterMap.has(root)) {
      clusterMap.set(root, { entries: new Set(), pairs: [], total: 0, types: new Map() });
    }
    const cluster = clusterMap.get(root)!;
    cluster.entries.add(ka);
    cluster.entries.add(kb);
    cluster.pairs.push(pair);
    cluster.total += pair.confusionCount;
    cluster.types.set(
      pair.confusionType,
      (cluster.types.get(pair.confusionType) ?? 0) + pair.confusionCount,
    );
  }

  // Convert and sort
  return [...clusterMap.values()]
    .map((c) => {
      // Find dominant type
      let maxCount = 0;
      let dominantType = "visual_kanji";
      for (const [type, count] of c.types) {
        if (count > maxCount) {
          maxCount = count;
          dominantType = type;
        }
      }
      return {
        entries: [...c.entries].map(parseKey),
        pairs: c.pairs.sort((a, b) => b.confusionCount - a.confusionCount),
        totalConfusions: c.total,
        dominantType,
      };
    })
    .sort((a, b) => b.totalConfusions - a.totalConfusions);
}
