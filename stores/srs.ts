import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type RecordLogItem,
} from "ts-fsrs";

const params = generatorParameters({ maximum_interval: 365 });
const f = fsrs(params);

export { Rating };

export function createNewCard(): Card {
  return createEmptyCard();
}

export function reviewCard(card: Card, rating: Rating, now?: Date): RecordLogItem {
  const schedulingCards = f.repeat(card, now ?? new Date());
  return schedulingCards[rating];
}

export function getDueCards<T extends { due: string; state: number }>(cards: T[]): T[] {
  const now = new Date();
  return cards.filter((c) => new Date(c.due) <= now);
}
