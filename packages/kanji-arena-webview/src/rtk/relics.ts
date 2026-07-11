// Kotodama relics: run-scoped blessings offered after each elite/boss clear.
// Every effect is a guarded `run.relics.has(id)` read at a single combat hook —
// pure additive branches, no dual-path scaffolding. Definitions here are for the
// offer cards + HUD shelf; the effects live at their hooks in DungeonScene.

export type RelicId =
  | "tally-cord"
  | "kotodama-chorus"
  | "backfire-sink"
  | "echo-glyph"
  | "lapse-ledger"
  | "fluent-seal"
  | "ember-tithe"
  | "first-word"
  | "iron-focus"
  | "steady-tongue"
  | "twin-ward"
  | "oracles-tokens"
  | "descent-draught"
  | "fleet-tongue"
  | "long-shadow"
  | "cascade-bind"
  | "second-wind"
  | "deep-breath"
  | "patient-word"
  | "keen-eye"
  | "reprisal"
  | "bulwark"
  | "timekeeper"
  | "warded-descent"
  | "minds-eye"
  | "toll-ledger"
  | "fences-cut"
  | "warded-purse";

export interface Relic {
  id: RelicId;
  name: string;
  jp: string;
  flavor: string;
  effect: string;
}

export const RELICS: Relic[] = [
  {
    id: "tally-cord",
    name: "Tally Cord",
    jp: "数え緒",
    flavor: "A knotted cord remembers every true name you speak.",
    effect: "Correct reads build a streak; every 5 banks a Ward that soaks one backfire.",
  },
  {
    id: "kotodama-chorus",
    name: "Kotodama Chorus",
    jp: "言霊の合唱",
    flavor: "On a hot streak the word-spirits sing with you.",
    effect: "Streak ≥4: stronger Focus slow, and every card shows its components.",
  },
  {
    id: "backfire-sink",
    name: "Backfire Sink",
    jp: "反りの器",
    flavor: "A vessel that drinks the surge.",
    effect: "A backfire at streak ≥3 costs no heart — it burns your streak to zero instead.",
  },
  {
    id: "echo-glyph",
    name: "Echo Glyph",
    jp: "谺の紋",
    flavor: "A verb spoken once echoes to the next of its kind.",
    effect: "After a read, the next spirit of that same verb flashes its answer.",
  },
  {
    id: "lapse-ledger",
    name: "Lapse Ledger",
    jp: "失の帳",
    flavor: "Credit for facing the names you had forgotten.",
    effect: "Every 3rd rusty card you read correctly restores a heart.",
  },
  {
    id: "fluent-seal",
    name: "Fluent Seal",
    jp: "熟練の印",
    flavor: "Mastery, once proven, becomes flesh.",
    effect: "Every 5 mastered cards read cleanly raise your max hearts by 1.",
  },
  {
    id: "ember-tithe",
    name: "Ember Tithe",
    jp: "焔の供",
    flavor: "A kanji learned is a coal banked.",
    effect: "Study heals +1 more; binding that same glyph later grants a max heart.",
  },
  {
    id: "first-word",
    name: "The First Word",
    jp: "初言",
    flavor: "The first name you attempt forgives a stumble.",
    effect: "Your first misread in each room costs no heart.",
  },
  {
    id: "iron-focus",
    name: "Iron Focus",
    jp: "鉄の凝視",
    flavor: "While you are reading, the world cannot touch you.",
    effect: "No contact damage while a read is open.",
  },
  {
    id: "steady-tongue",
    name: "Steady Tongue",
    jp: "直言",
    flavor: "Your aim finds the verb it meant.",
    effect: "Shrinks the wheel dead-zone so near-miss aim still resolves.",
  },
  {
    id: "twin-ward",
    name: "Twin-Ward",
    jp: "双子の護",
    flavor: "Among the confusable kin, a first wrong reach only rings a bell.",
    effect: "In ordeals, the first wrong twin per need is harmless; correct reads add +2s.",
  },
  {
    id: "oracles-tokens",
    name: "Oracle's Tokens",
    jp: "神託の符",
    flavor: "Three whispered answers, held in reserve.",
    effect: "3 reveal charges per floor — press R mid-read to glow the true verb.",
  },
  {
    id: "descent-draught",
    name: "Descent Draught",
    jp: "降りの雫",
    flavor: "The descent itself becomes a balm.",
    effect: "Clearing a boss and descending heals 2 hearts.",
  },
  {
    id: "fleet-tongue",
    name: "Fleet Tongue",
    jp: "疾き舌",
    flavor: "The tongue that speaks and runs as one.",
    effect: "Read and run: +50% movement speed while a read is open.",
  },
  {
    id: "long-shadow",
    name: "Long Shadow",
    jp: "長き影",
    flavor: "Danger throws its shadow early.",
    effect: "Boss danger patches telegraph far longer before they strike.",
  },
  {
    id: "cascade-bind",
    name: "Cascade",
    jp: "連ね",
    flavor: "One true name calls its kin.",
    effect: "At streak ≥5, a correct read also binds the nearest spirit of that verb.",
  },
  {
    id: "second-wind",
    name: "Second Wind",
    jp: "息吹",
    flavor: "The breath that returns at the brink.",
    effect: "Once per floor, a killing blow leaves you at one heart instead.",
  },
  {
    id: "deep-breath",
    name: "Deep Breath",
    jp: "深呼吸",
    flavor: "Each descent, a fuller breath.",
    effect: "Descending heals to full and raises your max hearts by 1.",
  },
  {
    id: "patient-word",
    name: "Patient Word",
    jp: "静けさ",
    flavor: "In stillness, the spirits hold their breath.",
    effect: "Outside boss fights, holding a read fully freezes the spirits.",
  },
  {
    id: "keen-eye",
    name: "Keen Eye",
    jp: "慧眼",
    flavor: "The trained eye names the twin at a glance.",
    effect: "Each elite need briefly reveals its true verb on the wheel.",
  },
  {
    id: "reprisal",
    name: "Reprisal",
    jp: "意趣返し",
    flavor: "Struck, you answer truer.",
    effect: "Your first correct read after taking a hit restores a heart.",
  },
  {
    id: "bulwark",
    name: "Bulwark",
    jp: "防壁",
    flavor: "A wall raised before the first word.",
    effect: "Raises your maximum hearts by 2 the moment it's claimed.",
  },
  {
    id: "timekeeper",
    name: "Timekeeper",
    jp: "時守り",
    flavor: "The clock bends to a steady reader.",
    effect: "Each boss keyword you read adds +2 seconds to the clock.",
  },
  {
    id: "warded-descent",
    name: "Warded Descent",
    jp: "護りの降り",
    flavor: "You step down already shielded.",
    effect: "Begin each floor with a Ward already banked.",
  },
  {
    id: "minds-eye",
    name: "Mind's Eye",
    jp: "心眼",
    flavor: "The first name in each room comes clear.",
    effect: "The first read in each room reveals its verb on the wheel.",
  },
  {
    id: "toll-ledger",
    name: "Toll Ledger",
    jp: "関の帳",
    flavor: "Every name passing the gate pays its due.",
    effect: "Earn +1 extra kotodama for every spirit you bind.",
  },
  {
    id: "fences-cut",
    name: "Fence's Cut",
    jp: "故買の分け前",
    flavor: "Return a thief's haul and keep a finder's share.",
    effect: "Binding a Magpie mends a heart and doubles its bounty.",
  },
  {
    id: "warded-purse",
    name: "Warded Purse",
    jp: "財布の護",
    flavor: "No light finger finds your kotodama.",
    effect: "Magpies can no longer steal your kotodama.",
  },
];

export const RELIC_MAP: Record<RelicId, Relic> = Object.fromEntries(
  RELICS.map((r) => [r.id, r]),
) as Record<RelicId, Relic>;

export const RELIC_IDS: RelicId[] = RELICS.map((r) => r.id);
