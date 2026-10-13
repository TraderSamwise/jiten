/**
 * The cap on unseen cards a session introduces, and how many cards in learning
 * it takes on alongside them.
 *
 * The simple-SRS session used to load the whole list: 8,000 words meant 8,000
 * cards at once, none of which could collect the three correct answers a card
 * needs to graduate, so the same queue came back every day. Midori, which this
 * engine clones, mixes in about ten.
 *
 * These are the arithmetic. The QUERIES that apply them are gated by
 * `db/simple-queue.test.ts`, which runs the shipped `loadSimpleQueuePools`:
 * this file used to retype that SQL, and so proved nothing about the session.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEW_PER_SESSION,
  learningCapFor,
  resolveNewPerSession,
  SIMPLE_SRS_REQUIRED_CORRECT,
  UNLIMITED,
} from "@/stores/simple-srs";

describe("resolveNewPerSession", () => {
  it("falls back to the default when the list says nothing", () => {
    expect(resolveNewPerSession(null)).toBe(DEFAULT_NEW_PER_SESSION);
    expect(resolveNewPerSession(undefined)).toBe(DEFAULT_NEW_PER_SESSION);
  });

  it("never returns zero, which would send a session straight to the done screen", () => {
    expect(resolveNewPerSession(0)).toBe(1);
    expect(resolveNewPerSession(-5)).toBe(1);
  });

  it("keeps a chosen value and caps the absurd", () => {
    expect(resolveNewPerSession(25)).toBe(25);
    expect(resolveNewPerSession(10_000)).toBe(500);
  });
});
