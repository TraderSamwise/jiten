# RTK Primitives & Semantic Auto-Markup Mnemonics — Implementation Plan

Status: **in progress** · Epic 1 merged (PR #3) · rest planned.

## 1. Vision

Turn kanji mnemonics into a **structured, linked, RTK-primitive-aware** experience:

1. Show each kanji's **RTK primitive elements** (e.g. 宣 = 宀 _house_ + 亘 _span_) on the
   kanji page and in flashcards, matching the official "Remembering the Kanji" app.
2. Let a user's mnemonic **story** reference those primitives so the references render
   **inline, colored, and tappable** (deep-link to the primitive / kanji).
3. Make that linking **effortless**: an editor that behaves like an IDE with Copilot —
   ambient auto-linking as you type, plus a trigger-character dropdown for explicit
   linking — driven by **semantic detection**, not manual markup.

The detection is deliberately **noisy-tolerant**: it may auto-apply, but the moment the
user corrects it, it must **stop fighting** them.

## 2. Core technical decisions (settled)

### 2.1 Data source & delivery — DONE (Epic 1)

- Primitive decomposition + keywords come from the **proprietary RTK iOS app** Core Data
  SQLite, extracted once (`yarn build:rtk`, `scripts/kanji/extract-rtk-app-db.mjs`) into
  committed `data/rtk-primitives.json`. Source is proprietary; only the derived artifact
  is committed. (User accepted this posture.)
- Tables `kanji_primitives` + `primitives` live in the **strokes download tier**
  (`dictionary-strokes.db`) — small, kanji-scoped, already fetched for the kanji page —
  not a new tier or the 120MB main dict. Delivered by bumping the strokes manifest
  version; the rebuilt DB + manifest must be **published together**.
- Invented primitives (宀) have **no real Unicode glyph** (the RTK app uses private-font
  substitutes). They render **by keyword** and link **by `primitive_id`**. Real-kanji
  primitives (亘) render by glyph and link to the kanji page.

### 2.2 Semantic detection — NO vector DB

We reproduce how the **dictionary's English search** achieves "semantic" results without
embeddings (`db/search.ts`): **FTS5 + a stemmer (`stemForFts`) + a precomputed WordNet
synonym thesaurus (`expandWithSynonyms`) + tiered ranking**. Applied to auto-markup:

- **Official primitive meanings** → precompute a compact `keyword → synonyms` map for the
  ~2,400 RTK keywords, ship it in the strokes tier, and match each story word against
  **this kanji's 2–4 primitive keywords** via stem + synonym-expand + score. Scoped to one
  kanji's tiny primitive set, so it is precise.
- **User's own mnemonic archive** → the part WordNet can't give. Build a **personal lexical
  co-occurrence index** over `user_kanji_notes`: tokenize+stem every stored story, count
  which words the user uses in stories for kanji containing each primitive, frequency-
  weighted → a `word → primitive` association table, updated incrementally on save. Purely
  lexical (counts), **no embeddings, no vector DB.**
- A span auto-links when the **official** synonym/stem match OR the **personal** association
  crosses a confidence threshold. The resolver returns ranked candidates + confidence +
  a stable target.

### 2.3 Markup language (stored form)

- `[label](target)` — visible `label` (the user's actual word: "home", "relaxing")
  decoupled from a **stable `target`** (glyph for real-kanji primitives, `p<id>` for
  invented ones). Rename-proof, disambiguated, allows custom wording.
- `[label]` bare shorthand — no target → resolved by keyword at render time (fast hand
  authoring; editor can "harden" to a stable target).
- `{self}` — this kanji's own keyword (primary highlight).
- Legacy migration: existing `**x**`/`*x*` stories → strip the literal sigils; auto-link
  re-derives the highlighting. (No fragile conversion.)

### 2.4 Editor UX — IDE-with-Copilot model

Two affordances over the **same candidate resolver**:

1. **Ambient (Copilot-style, Tab-to-accept):** high-confidence links are suggested/auto-
   applied inline as you type prose; **Tab** confirms a ghosted suggestion.
2. **Dropdown-on-type (explicit):** typing a link token like `[hou` opens a live filtered
   dropdown of candidate targets (`house`, `home`, …), IDE symbol-completion style.

**Correction ergonomics (ephemeral, NOT learning):**

- Auto-apply is allowed, but **once corrected/dismissed, do not re-apply at that spot for
  the rest of the edit session** (in-memory `Set`, anchor-keyed). Exactly the Apple-
  keyboard autocorrect parallel: back off _now_, but it is not a permanent rule.
- **New edit session → forget** the suppression (state cleared on editor unmount/close).
- **Draft vs edit intent:** appending forward = drafting (suggestions flow on new spans);
  going back to modify an existing span = correcting (suppress that anchor + debounce so
  it does not re-autocorrect the word being fixed).
- Anchor a suppression on `(span text + suggested target)` with fuzzy position, so it
  survives edits elsewhere but a genuinely new later occurrence can still suggest.

Keep these two layers strictly separate:

- **Durable (learning):** the personal co-occurrence index. Cross-session, improves detection.
- **Ephemeral (ergonomics):** session suppression. Not persisted, forgotten next session.

## 3. Epics & phases

Each phase is a plan-execute unit (plan → audit → implement → audit → commit). Each **epic**
boundary = open a PR → review-coderabbit until green → merge → cut the next branch.

### Epic 1 — Primitive data layer ✅ DONE (PR #3, merged)

- Phase 0: `extract-rtk-app-db.mjs` → `data/rtk-primitives.json`.
- Phase 1: `kanji_primitives` + `primitives` in the strokes tier; `build:strokes-primitives`;
  `getPrimitivesForKanjiAsync` / `getPrimitiveAsync`; strokes manifest v1→2.
- **Follow-up (not code):** publish the rebuilt `dictionary-strokes.db` + manifest together.

### Epic 2 — Primitive rendering (read-only payoff)

No detection/editing yet — just make the data visible and linkable.

- KanjiDetail: a **"Primitive Elements"** section (glyph/keyword, tappable), matching the RTK app.
- Flashcard: render primitives on the card.
- New **primitive-detail route** for invented primitives (glyph substitute or keyword,
  "appears in" reverse list, own story).
- Deep-linking: real-kanji primitives → kanji page (`useTabRouter().pushKanji`); invented →
  primitive route.
- Reverse index: `kanji-used-as-primitive-in` (for 案 ← 安 style cross-refs).
- Acceptance: 宣 shows house + span, tapping navigates correctly; graceful when strokes tier
  not yet downloaded.

### Epic 3 — Semantic candidate resolver (no vector DB)

The engine both editor surfaces consume.

- **3a** Build step: precomputed `keyword → synonyms` map for RTK keywords → strokes tier
  (compact). Reuse `stemForFts` + synonym expansion from `db/search.ts`.
- **3b** Personal co-occurrence index: a user-DB table built/updated from `user_kanji_notes`
  (tokenize+stem+count word→primitive associations); incremental on save; synced or local-only
  (decide during phase — likely local-only, derivable).
- **3c** Resolver API: `resolveCandidates(kanji, span) → [{ target, label, confidence, source }]`
  combining official (scoped stem+synonym+rank) + personal, with a threshold. Unit-tested with
  fixtures.
- Acceptance: "home"→宀, "relaxing"→relax, "cheap"→安 resolve with sensible confidence on
  fixtures; unknown words return nothing.

### Epic 4 — Markup language + linked renderer

- `lib/mnemonic-markup.ts`: parser for `[label](target)`, `[label]`, `{self}`, escapes → AST.
- Rewrite `components/MnemonicText.tsx`: AST → `<Text>`/`<Pressable>` tokens; primary keyword
  (blue), primitive refs (green, tappable → resolver/deep-link); real-kanji refs append glyph.
- Dynamic resolution: bare `[label]` and `{self}` resolve at render time against the kanji's
  decomposition + resolver.
- One-time legacy sigil-strip migration of existing `user_kanji_notes`.
- Direct cutover of the old `highlight-keywords.ts` fuzzy matcher.
- Acceptance: a stored story with `[home](p51)` renders "home" green + tappable → primitive 51;
  existing `**/*` stories render correctly post-migration.

### Epic 5 — Suggestor editor (the crux)

- Ambient auto-linker: as-you-type detection via the resolver; high-confidence → ghost/auto-
  apply; **Tab** to accept.
- Trigger-char dropdown: `[` opens a filtered candidate dropdown (resolver-backed).
- Correction/suppression: session-scoped `Set` (anchor-keyed), cleared on unmount; draft-vs-
  edit intent detection + debounce so it never re-fights a correction.
- "Unused primitives" nudge: primitives not yet referenced stay highlighted in a bar.
- Acceptance: typing "home" auto-links to 宀; deleting the link stops it re-applying this
  session; reopening later re-offers; `[` shows a working dropdown.

### Epic 6 — Feedback loop + polish

- Confirmations/edits update the durable personal co-occurrence index (counts only).
- Threshold tuning; empty/degraded states (strokes tier missing); performance (slice-local,
  no full-archive scans on every keystroke — respect the reader/DB perf invariants).
- Sync review for any new user-DB tables.

## 4. Open questions / risks

- **Publish step** for the strokes DB (Epic 1 follow-up) is a real production action — do it
  deliberately, DB + manifest atomically.
- **Personal index location**: local-only vs synced (`user_kanji_notes` is synced; the derived
  index is probably local + rebuildable). Decide in Epic 3b.
- **Confidence thresholds**: auto-apply vs suggest-only bands need real-data tuning (Epic 6).
- **Noise**: over-linking common words ("in", "own"). Stop-word filtering + per-kanji scoping
  mitigate; the no-fight ergonomics are the safety net.
- **Perf**: detection must be slice/story-local per keystroke, never scan the whole archive
  live (build the personal index incrementally, query it O(1)).
- **Licensing**: primitive data is proprietary RTK-app-derived (user-accepted).

## 5. Done / next

- ✅ Epic 1 (PR #3 merged): data layer.
- ▶ Next: Epic 2 (primitive rendering) on branch `feat/rtk-mnemonic-markup` (or a fresh
  `feat/rtk-primitive-rendering`), then Epics 3→6.
