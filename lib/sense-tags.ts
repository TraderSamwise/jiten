/**
 * JMdict `misc` codes, spelled out. The dictionary stores them as a
 * comma-separated string on each sense ("abbr", "uk, col"), which is how it
 * records that 各停 is short for 各駅停車 — information the app kept but never
 * showed. Anything not in the table is passed through as written rather than
 * dropped, so a new JMdict code degrades to its raw form instead of vanishing.
 */
const MISC_LABELS: Record<string, string> = {
  abbr: "abbreviation",
  arch: "archaic",
  char: "character",
  chn: "children's language",
  col: "colloquial",
  company: "company name",
  creat: "creature",
  dated: "dated",
  dei: "deity",
  derog: "derogatory",
  doc: "document",
  euph: "euphemistic",
  ev: "event",
  fam: "familiar language",
  fem: "female term or language",
  fict: "fiction",
  form: "formal",
  given: "given name",
  group: "group",
  hist: "historical",
  hon: "honorific",
  hum: "humble",
  id: "idiomatic expression",
  joc: "jocular",
  leg: "legend",
  "m-sl": "manga slang",
  male: "male term or language",
  myth: "mythology",
  "net-sl": "internet slang",
  obj: "object",
  obs: "obsolete",
  "on-mim": "onomatopoeic or mimetic",
  organization: "organization name",
  person: "person",
  place: "place name",
  poet: "poetical",
  pol: "polite",
  product: "product name",
  proverb: "proverb",
  quote: "quotation",
  rare: "rare",
  sens: "sensitive",
  serv: "service",
  ship: "ship name",
  sl: "slang",
  surname: "surname",
  uk: "usually written in kana",
  unclass: "unclassified name",
  vulg: "vulgar",
  work: "work of art or literature",
  yoji: "four-character idiom",
};

/** Every JMdict misc code this table spells out. */
export const KNOWN_MISC_CODES: ReadonlySet<string> = new Set(Object.keys(MISC_LABELS));

/** Readable labels for a sense's `misc` string, in the order the dictionary lists them. */
export function formatSenseMisc(misc: string | null | undefined): string[] {
  if (!misc) return [];
  return misc
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => MISC_LABELS[code] ?? code);
}

/** True when the sense is marked as an abbreviation of a longer form. */
export function isAbbreviationSense(misc: string | null | undefined): boolean {
  if (!misc) return false;
  return misc.split(",").some((code) => code.trim() === "abbr");
}
