import { stepsForCrown, type CourseFrame, type NodeStep } from "./rtk-course";

/**
 * One pass over a node, as a pure queue. The screen asks for the current item,
 * reports a hit or a miss, and gets a new state back; nothing here touches a
 * database, a clock or React.
 */

export interface SessionItem {
  frame: CourseFrame;
  step: NodeStep;
}

export interface SessionState {
  queue: readonly SessionItem[];
  /** Items answered right, in the order they were finished. */
  cleared: readonly SessionItem[];
  /** Items skipped outright — a cloze with no story to clozed. */
  skipped: readonly SessionItem[];
  misses: number;
}

/** A missed item comes back this far down the queue, not immediately. */
const REQUEUE_AFTER = 2;

/**
 * Meet every frame first, then drill step by step rather than frame by frame:
 * the five frames of a node are each tested once before any is tested twice,
 * which is the only spacing a single session can offer.
 */
export function startSession(frames: readonly CourseFrame[], crown: number): SessionState {
  const steps = stepsForCrown(crown);
  const queue: SessionItem[] = [];
  for (const step of steps) {
    for (const frame of frames) queue.push({ frame, step });
  }
  return { queue, cleared: [], skipped: [], misses: 0 };
}

export function currentItem(state: SessionState): SessionItem | null {
  return state.queue[0] ?? null;
}

export function isComplete(state: SessionState): boolean {
  return state.queue.length === 0;
}

/** Everything the session will ask, answered or not — for a progress bar. */
export function sessionTotal(state: SessionState): number {
  return state.queue.length + state.cleared.length + state.skipped.length;
}

export function sessionAnswered(state: SessionState): number {
  return state.cleared.length + state.skipped.length;
}

export function advance(state: SessionState, outcome: "hit" | "miss"): SessionState {
  const [current, ...rest] = state.queue;
  if (!current) return state;

  if (outcome === "hit") {
    return { ...state, queue: rest, cleared: [...state.cleared, current] };
  }

  const at = Math.min(REQUEUE_AFTER, rest.length);
  const queue = [...rest.slice(0, at), current, ...rest.slice(at)];
  return { ...state, queue, misses: state.misses + 1 };
}

/** Drops the current item without counting it either way. */
export function skipCurrent(state: SessionState): SessionState {
  const [current, ...rest] = state.queue;
  if (!current) return state;
  return { ...state, queue: rest, skipped: [...state.skipped, current] };
}

/** Drops every remaining item of one step — the cloze steps of a storyless node. */
export function dropStep(state: SessionState, step: NodeStep): SessionState {
  const dropped = state.queue.filter((item) => item.step === step);
  if (dropped.length === 0) return state;
  return {
    ...state,
    queue: state.queue.filter((item) => item.step !== step),
    skipped: [...state.skipped, ...dropped],
  };
}
