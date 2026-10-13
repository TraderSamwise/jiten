/**
 * Every number in docs/simple-srs-decisions.md, regenerated.
 *
 *   yarn simulate:srs            # all scenarios
 *   yarn simulate:srs ratchet    # one, by name
 *
 * This exists because review could not reproduce the tables from their prose
 * description: the answer-count spread, the daily budget and the intra-day
 * re-queue rule all change the result, and none of them were written down. A
 * number nobody else can produce is not a measurement, so the simulation
 * ships and the doc quotes its output.
 *
 * Everything runs through the shipped `nextSimpleReview`, never a restatement
 * of the rules — the lapse bug lived in a call site and survived every test
 * that reimplemented the arithmetic.
 */

import {
  dateToSrsEpochDays,
  nextSimpleReview,
  learningCapFor,
  UNLIMITED,
} from "../stores/simple-srs";
import type { SrsCardRow } from "../db/types";

const DAY = 86_400_000;
const DECK = 8000;
/** Accuracy on graduated cards, and on cards still in learning. */
const PASS_GRADUATED = 0.9;
const PASS_LEARNING = 0.8;

/**
 * Pass `--seed=N` to resample. A four-digit cell is one sample of a stochastic
 * process: the conclusions here hold across seeds, the exact numbers do not, so
 * re-run before quoting a new one.
 */
const SEED = Number(process.argv.find((a) => a.startsWith("--seed="))?.slice(7) ?? 7);

/** Deterministic LCG, so every run of this file prints the same table. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

type Card = SrsCardRow & { id: string };

function card(id: string, fields: Partial<Card> = {}): Card {
  return {
    id,
    simpleStage: null,
    simpleN: null,
    simpleInterval: null,
    simpleRelearning: 0,
    simpleRun: 0,
    reps: 0,
    lapses: 0,
    ...fields,
  } as Card;
}

/**
 * One day of study.
 *
 * The queue is what the session loads: cards in learning (optionally capped)
 * ahead of graduated cards due by the cutoff, then unseen cards up to the new
 * cap. The learner answers up to `budget` cards; a card that fails or has not
 * yet collected three correct answers is pushed back into the same day's queue,
 * because the session re-queues it about ten cards away rather than ending.
 */
function studyOneDay(
  deck: Card[],
  day: number,
  t0: number,
  budget: number,
  newPerDay: number,
  learningCap: number,
  rand: () => number,
): { shown: number; answered: number } {
  const cutoff = dateToSrsEpochDays(new Date(t0 + (day + 1) * DAY));
  const learning = deck.filter((c) => c.simpleStage === 0 && (c.simpleN ?? 0) <= cutoff);
  const graduated = deck.filter((c) => c.simpleStage === 1 && (c.simpleN ?? 0) <= cutoff);
  const unseen = deck.filter((c) => c.simpleStage == null);

  const queue = [
    ...(learningCap === UNLIMITED ? learning : learning.slice(0, learningCap)),
    ...graduated,
    ...unseen.slice(0, newPerDay),
  ];
  const shown = queue.length;

  let answered = 0;
  while (queue.length && answered < budget) {
    const c = queue.shift()!;
    answered++;
    const threshold = c.simpleStage === 1 ? PASS_GRADUATED : PASS_LEARNING;
    const decision = nextSimpleReview(c, rand() < threshold ? "pass" : "fail");
    Object.assign(c, decision.updates);
    c.reps = (c.reps ?? 0) + 1;
    if (decision.updates.simpleRun === 0 && decision.updates.simpleStage === 0) {
      c.lapses = (c.lapses ?? 0) + 1;
    }
    if (decision.graduated) {
      c.simpleN = dateToSrsEpochDays(new Date(t0 + day * DAY)) + (c.simpleInterval ?? 0);
    } else {
      queue.push(c);
    }
  }
  return { shown, answered };
}

interface Run {
  shown: number[];
  answered: number[];
  /** Cards that reached stage 1 at any point. */
  graduatedEver: number;
  /** Cards still graduated at the end, above a one-day interval — i.e. learned. */
  learnedAtEnd: number;
}

function simulate(opts: {
  deck: Card[];
  days: number;
  budget: number;
  newPerDay: number;
  learningCap: number;
  seed?: number;
}): Run {
  const t0 = Date.now();
  const rand = rng(opts.seed ?? SEED);
  const shown: number[] = [];
  const answered: number[] = [];
  const graduated = new Set<string>();
  for (let day = 0; day < opts.days; day++) {
    const result = studyOneDay(
      opts.deck,
      day,
      t0,
      opts.budget,
      opts.newPerDay,
      opts.learningCap,
      rand,
    );
    for (const c of opts.deck) if (c.simpleStage === 1) graduated.add(c.id);
    shown.push(result.shown);
    answered.push(result.answered);
  }
  // "Touched stage 1 once" flatters a deck that is churning: a card can
  // graduate, fail, and sit back at the floor. What the learner has actually
  // kept is a card still graduated and no longer due daily.
  const learnedAtEnd = opts.deck.filter(
    (c) => c.simpleStage === 1 && (c.simpleInterval ?? 0) > 1,
  ).length;
  return { shown, answered, graduatedEver: graduated.size, learnedAtEnd };
}

const MARKS = [0, 6, 29, 89, 179, 364];
const at = (xs: number[]) => MARKS.map((d) => (xs[d] ?? 0).toString().padStart(5));
const header = "| " + MARKS.map((d) => `d${d + 1}`.padStart(5)).join(" | ") + " |";

/** Floored: every card graduated but pinned at the 8-hour floor. */
const flooredDeck = (interval: (i: number) => number) =>
  Array.from({ length: DECK }, (_, i) =>
    card(`f${i}`, {
      simpleStage: 1,
      simpleN: 0,
      simpleInterval: interval(i),
      reps: 40,
      lapses: 5,
    }),
  );

/** Left in learning by the uncapped session: answered once, never graduated. */
const learningDeck = () =>
  Array.from({ length: DECK }, (_, i) =>
    card(`l${i}`, { simpleStage: 0, simpleN: 0, simpleInterval: 1 / 3, reps: 14, lapses: 2 }),
  );

const SCENARIOS: Record<string, () => void> = {
  /** The interval a card ends on after N answers, under each lapse rule. */
  ratchet() {
    console.log("\n## The ratchet (one card, 20,000 samples, 90% accuracy)\n");
    console.log("| answers | at or below 1 day, bugged | with the fix |");
    console.log("| --- | --- | --- |");
    for (const answers of [20, 40, 45, 50]) {
      const counts = [0, 0];
      for (const [slot, bugged] of [
        [0, true],
        [1, false],
      ] as const) {
        for (let seed = 1; seed <= 20_000; seed++) {
          const rand = rng(seed * 7919 + answers);
          const c = card("c");
          for (let i = 0; i < answers; i++) {
            const pass = rand() < 0.9;
            // The bug: anything that ever failed counts as relearning, forever.
            const seen = bugged ? { ...c, simpleRelearning: (c.lapses ?? 0) > 0 ? 1 : 0 } : c;
            const d = nextSimpleReview(seen as SrsCardRow, pass ? "pass" : "fail");
            Object.assign(c, d.updates);
            c.reps = (c.reps ?? 0) + 1;
            if (!pass) c.lapses = (c.lapses ?? 0) + 1;
          }
          if ((c.simpleInterval ?? 0) <= 1) counts[slot]++;
        }
      }
      const pct = (n: number) => `${((100 * n) / 20_000).toFixed(1)}%`;
      console.log(`| ${answers} | ${pct(counts[0])} | ${pct(counts[1])} |`);
    }
  },

  /** Does a flattened deck drain on its own, and does a repair help? */
  drain() {
    console.log("\n## Draining a deck of 8,000 cards pinned at the floor\n");
    console.log(`(seed ${SEED})\n`);
    console.log("| answers/day | repair | " + header.slice(2));
    console.log("| --- | --- |" + MARKS.map(() => " --- |").join(""));
    for (const budget of [1000, 200, 150]) {
      for (const [label, interval] of [
        ["none", () => 1 / 3],
        ["spread 2-30d", (i: number) => 2 + (i % 29)],
        ["flat 7d", () => 7],
      ] as const) {
        const run = simulate({
          deck: flooredDeck(interval),
          days: 365,
          budget,
          newPerDay: 0,
          learningCap: UNLIMITED,
          seed: SEED,
        });
        console.log(`| ${budget} | ${label} | ` + at(run.shown).join(" | ") + " |");
      }
    }
  },

  /** Which rows a repair can tell apart from honest ones. */
  discriminate() {
    console.log("\n## Telling a ratchet victim from a card honestly at the floor\n");
    // Reps only varies if cards have lived different lengths, so the sample is
    // 400 seeds x nine answer counts = 3,600 cards, under each rule.
    const ANSWER_COUNTS = [4, 8, 12, 16, 24, 32, 48, 64, 96];
    const population = (accuracy: number, bugged: boolean) => {
      const out: Card[] = [];
      for (let seed = 1; seed <= 400; seed++) {
        for (const answers of ANSWER_COUNTS) {
          const rand = rng(seed * 7919 + answers);
          const c = card(`${seed}-${answers}`);
          for (let i = 0; i < answers; i++) {
            const pass = rand() < accuracy;
            const seen = bugged ? { ...c, simpleRelearning: (c.lapses ?? 0) > 0 ? 1 : 0 } : c;
            const d = nextSimpleReview(seen as SrsCardRow, pass ? "pass" : "fail");
            Object.assign(c, d.updates);
            c.reps = (c.reps ?? 0) + 1;
            if (!pass) c.lapses = (c.lapses ?? 0) + 1;
          }
          out.push(c);
        }
      }
      return out;
    };
    const floored = (c: Card) => (c.simpleInterval ?? 0) <= 0.34;
    console.log("| accuracy | clause | victims caught | honest lifted |");
    console.log("| --- | --- | --- | --- |");
    for (const accuracy of [0.9, 0.75]) {
      const victims = population(accuracy, true).filter(floored);
      const honest = population(accuracy, false).filter(floored);
      for (const [label, test] of [
        ["reps >= 3", (c: Card) => (c.reps ?? 0) >= 3],
        ["reps >= 12", (c: Card) => (c.reps ?? 0) >= 12],
        ["reps >= 20", (c: Card) => (c.reps ?? 0) >= 20],
        ["lapses >= 3", (c: Card) => (c.lapses ?? 0) >= 3],
      ] as const) {
        const hit = (c: Card) => floored(c) && (c.lapses ?? 0) > 0 && test(c);
        console.log(
          `| ${accuracy} | interval <= 0.34, ${label} | ` +
            `${victims.filter(hit).length} / ${victims.length} | ` +
            `${honest.filter(hit).length} / ${honest.length} |`,
        );
      }
      const graduated = victims.filter((c) => c.simpleStage === 1);
      const shipped = graduated.filter((c) => (c.reps ?? 0) >= 12 && (c.lapses ?? 0) > 0);
      console.log(
        `| ${accuracy} | **the shipped clause** (also \`simple_stage = 1\`) | ` +
          `${shipped.length} / ${victims.length} | — |`,
      );
      console.log(
        `| ${accuracy} | *of which graduated* | ${graduated.length} / ${victims.length} | — |`,
      );
    }
  },

  /** What capping the learning slice costs and saves. */
  learningCap() {
    console.log(`(seed ${SEED})`);
    console.log("\n## Capping the learning slice of a legacy deck\n");
    console.log(
      "| learning cap | answers/day | " + header.slice(2) + " touched stage 1 | learned |",
    );
    console.log("| --- | --- |" + MARKS.map(() => " --- |").join("") + " --- | --- |");
    for (const budget of [200, 400]) {
      for (const cap of [UNLIMITED, learningCapFor(10), 10]) {
        const run = simulate({
          deck: learningDeck(),
          days: 365,
          budget,
          newPerDay: 0,
          learningCap: cap,
          // Every row of a comparison shares the seed, or the thing being
          // compared is confounded with the sample: sampling each cap from its
          // own stream made a cap of ten look ahead of thirty at 200 answers a
          // day, which reversed at every other seed.
          seed: SEED,
        });
        const label = cap === UNLIMITED ? "none" : String(cap);
        console.log(
          `| ${label} | ${budget} | ` +
            at(run.shown).join(" | ") +
            ` | ${run.graduatedEver} | ${run.learnedAtEnd} |`,
        );
      }
    }
  },

  /** Is the x3 multiplier ahead of a flat cap, across seeds? */
  capSeeds() {
    console.log("\n## The learning cap's multiplier, across seeds\n");
    console.log("| seed | answers/day | kept, cap 30 | kept, cap 10 | uncapped |");
    console.log("| --- | --- | --- | --- | --- |");
    for (const seed of [7, 11, 42, 99]) {
      for (const budget of [200, 400]) {
        const kept = (cap: number) =>
          simulate({
            deck: learningDeck(),
            days: 365,
            budget,
            newPerDay: 0,
            learningCap: cap,
            seed,
          }).learnedAtEnd;
        console.log(
          `| ${seed} | ${budget} | ${kept(learningCapFor(10))} | ${kept(10)} | ${kept(UNLIMITED)} |`,
        );
      }
    }
  },

  /** The steady state the fixed engine settles into on a fresh deck. */
  steady() {
    console.log("\n## A fresh 8,000-card deck, ten new a day, fixed engine\n");
    const deck = Array.from({ length: DECK }, (_, i) => card(`n${i}`));
    const run = simulate({
      deck,
      days: 365,
      budget: 1000,
      newPerDay: 10,
      learningCap: learningCapFor(10),
    });
    console.log("| | " + header.slice(2));
    console.log("| --- |" + MARKS.map(() => " --- |").join(""));
    console.log("| shown | " + at(run.shown).join(" | ") + " |");
    console.log("| answered | " + at(run.answered).join(" | ") + " |");
  },
};

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const names = requested.length ? requested : Object.keys(SCENARIOS);
for (const name of names) {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`unknown scenario: ${name} (have: ${Object.keys(SCENARIOS).join(", ")})`);
    process.exit(1);
  }
  scenario();
}
