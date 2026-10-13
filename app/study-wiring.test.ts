/**
 * The study screen's wiring, checked in its source.
 *
 * This is a guard, not a behavioural test, and it exists because review proved
 * the same thing three rounds running: no test imports
 * `app/(tabs)/lists/study.tsx`, so the whole fix is one-line revertable with the
 * full suite green. Moving the SQL into `db/simple-queue.ts` gated the SQL; it
 * did not gate the screen *calling* it, and the commit message that claimed
 * otherwise was wrong.
 *
 * Each assertion below corresponds to a mutation that was demonstrated to
 * survive 2,570 passing tests:
 *
 * - `newCap = UNLIMITED` — the 8,000-card queue, restored.
 * - deleting `simple_run = ?` from the persistence UPDATE — the graduation fix,
 *   fully reverted.
 * - `newAllowance` → `newCap` — "Continue Studying" grants a fresh allowance.
 * - deleting `newAnsweredRef.current.add` — the allowance never spends.
 *
 * A source check cannot prove behaviour, and a determined edit can satisfy it
 * while breaking the screen. It catches the accidental revert, which is the one
 * that actually happens.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = readFileSync(join(REPO_ROOT, "app/(tabs)/lists/study.tsx"), "utf8");

/** Source with comments stripped, so a comment cannot satisfy an assertion. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the study screen loads its pools through the tested module", () => {
  it("calls loadSimpleQueuePools rather than its own SQL", () => {
    expect(CODE).toContain("loadSimpleQueuePools({");
    // No hand-rolled copy of the queries it replaced.
    expect(CODE).not.toMatch(/simple_stage\s+IS\s+NULL\s+AND\s+deleted_at/);
    expect(CODE).not.toMatch(/simple_stage\s*=\s*0\s+AND\s+simple_n/);
  });

  it("resolves the cap from the list row instead of hard-coding one", () => {
    expect(CODE).toMatch(/newCap\s*=\s*resolveNewPerSession\(/);
    expect(CODE).toContain("SELECT new_per_session FROM lists WHERE id = ?");
    // The ephemeral exemption is the only unlimited path.
    expect(CODE).toMatch(/isEphemeralListId\(listId\)/);
  });

  it("passes both the cap and what is left of it", () => {
    const call = CODE.slice(CODE.indexOf("loadSimpleQueuePools({"));
    const args = call.slice(0, call.indexOf("});"));
    expect(args).toMatch(/\bnewCap\b/);
    expect(args).toMatch(/\bnewAllowance\b/);
    expect(args).toMatch(/excludeIds/);
  });

  it("computes the allowance from the cards it has answered", () => {
    expect(CODE).toMatch(
      /newAllowance\s*=[\s\S]{0,120}Math\.max\(0,\s*newCap\s*-\s*newAnsweredRef\.current\.size\)/,
    );
    expect(CODE).toMatch(/newAnsweredRef\.current\.add\(card\.id\)/);
    // And an undone answer is refunded, or a walk-back strands the session.
    expect(CODE).toMatch(/newAnsweredRef\.current\.delete\(card\.id\)/);
  });
});

describe("the study screen persists what the engine decided", () => {
  it("writes every field a simple-SRS answer produces", () => {
    const update = CODE.slice(CODE.indexOf("UPDATE srs_cards SET simple_stage = ?"));
    const statement = update.slice(0, update.indexOf("`"));
    for (const column of [
      "simple_stage",
      "simple_n",
      "simple_interval",
      "simple_relearning",
      "simple_run",
    ]) {
      expect(statement).toContain(`${column} = ?`);
    }
    const binds = update.slice(0, update.indexOf("card.id,"));
    for (const field of [
      "updates.simpleStage",
      "updates.simpleN",
      "updates.simpleInterval",
      "updates.simpleRelearning",
      "updates.simpleRun",
    ]) {
      expect(binds).toContain(field);
    }
  });

  it("takes the decision from nextSimpleReview rather than recomputing it", () => {
    expect(CODE).toMatch(/nextSimpleReview\(card,\s*action\)/);
    // The lapse bug was this call site handing `simpleGraduate` a lifetime
    // counter, so the screen must not reach for the engine's internals.
    expect(CODE).not.toContain("simpleGraduate(");
    expect(CODE).not.toContain("card.lapses > 0");
  });
});
