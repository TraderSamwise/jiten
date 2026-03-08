import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type FSRS,
  type RecordLogItem,
} from "ts-fsrs";

const defaultInstance = fsrs(generatorParameters({ maximum_interval: 365 }));

const instanceCache = new Map<string, FSRS>();

export function getFsrsInstance(
  learningSteps: string[] = ["1m", "10m"],
  relearningSteps: string[] = ["10m"],
): FSRS {
  const key = `${learningSteps.join(",")}_${relearningSteps.join(",")}`;
  let instance = instanceCache.get(key);
  if (!instance) {
    instance = fsrs(
      generatorParameters({
        maximum_interval: 365,
        enable_short_term: true,
        learning_steps: learningSteps as any,
        relearning_steps: relearningSteps as any,
      }),
    );
    instanceCache.set(key, instance);
  }
  return instance;
}

export { Rating };

export function createNewCard(): Card {
  return createEmptyCard();
}

export function reviewCard(card: Card, rating: Rating, now?: Date, f?: FSRS): RecordLogItem {
  const instance = f ?? defaultInstance;
  const schedulingCards = instance.repeat(card, now ?? new Date());
  return (schedulingCards as any)[rating] as RecordLogItem;
}

export function previewIntervals(card: Card, now?: Date, f?: FSRS): Record<Rating, Date> {
  const instance = f ?? defaultInstance;
  const results = instance.repeat(card, now ?? new Date());
  return {
    [Rating.Again]: (results as any)[Rating.Again].card.due,
    [Rating.Hard]: (results as any)[Rating.Hard].card.due,
    [Rating.Good]: (results as any)[Rating.Good].card.due,
    [Rating.Easy]: (results as any)[Rating.Easy].card.due,
  } as Record<Rating, Date>;
}

export function getDueCards<T extends { due: string; state: number }>(cards: T[]): T[] {
  const now = new Date();
  return cards.filter((c) => new Date(c.due) <= now);
}
