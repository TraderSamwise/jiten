/**
 * Labelled bookmark-highlighting cases.
 *
 * Every case comes from one real page of a novel read on 2026-10-01 against a
 * real 8,586-entry bookmark list, walked span by span with the reader's owner
 * giving a verdict on each. The diagnosis is in
 * `docs/bookmark-highlight-bugs-v1.md`; the repair plan is
 * `docs/bookmark-highlight-plan-v1.md`.
 *
 * **The sentences here are written for this repo.** The page is in copyright,
 * so what is reproduced is the grammatical construction — ではない, 汗にして流し,
 * 何かしら, 女友だち, にわたる, けれど — never the novel's prose. The
 * constructions are ordinary Japanese and carry no rights. The real page lives
 * at `.cache/highlight-page.txt`, gitignored, as a local acceptance check.
 *
 * `mustNotHighlight` is the valuable half: it is the regression net this
 * feature has never had. A span is compared whole — 飽きない contains き, but
 * the painted span is 飽きない, so listing き here would not fire on it.
 */

export interface HighlightCase {
  /** Finding numbers in bookmark-highlight-bugs-v1.md. */
  id: string;
  /** Plain Japanese. Wrapped in `<p>` by the test. */
  text: string;
  /**
   * Pre-wrapped HTML, when the case is about rendering rather than matching.
   * Used instead of `text` when present.
   */
  html?: string;
  /** Entry ids treated as bookmarked for this case. */
  bookmarks: number[];
  /** Spans that must be painted, whole. */
  mustHighlight: string[];
  /** Spans that must not be painted. */
  mustNotHighlight: string[];
  /**
   * Must be painted as ONE span, not merely as a run of abutting ones. Only
   * worth stating where a word is split by its own ruby: the characters are
   * contiguous, so the box test passes while the reader still sees a seam.
   */
  mustBeOneSpan?: string[];
  /**
   * Spans the owner has not ruled on. Asserted neither way, listed so that a
   * later change to one of them is a deliberate decision and not a surprise.
   */
  undecided?: string[];
  /**
   * Expectations the shipping code does NOT meet yet. They run as `it.fails`,
   * so the suite is green while the bug stands AND goes red the moment the bug
   * is fixed — which is the prompt to delete the entry. Names here are taken
   * from `mustHighlight` and `mustNotHighlight`; a name appears in only one.
   */
  knownRed?: string[];
  /** As `knownRed`, for the single `mustBeOneSpan` expectation of a case. */
  knownRedSeam?: boolean;
  note: string;
}

export const BOOKMARK_HIGHLIGHT_CASES: HighlightCase[] = [
  {
    id: "1",
    knownRed: ["はない"],
    text: "それは私の本ではない。",
    bookmarks: [1427900 /* 張る はる v5r */],
    mustHighlight: [],
    mustNotHighlight: ["はない"],
    note: "ではない is the copula negated. はない is a legal negative of 張る in the wrong place.",
  },
  {
    id: "3",
    text: "毎朝ウォーキングに励み、体を動かす。",
    bookmarks: [1557390 /* 励む はげむ v5m */],
    mustHighlight: ["励み"],
    mustNotHighlight: [],
    note: "Accepted. The masu-stem of a bookmarked verb, in the right place. On tap the owner wants 励む, not 励み — that is phase 5.",
  },
  {
    id: "4",
    knownRed: ["通"],
    text: "妹はヨガのスタジオに通い、汗を流す。",
    bookmarks: [1432840 /* 通 つう n */],
    mustHighlight: [],
    mustNotHighlight: ["通"],
    note: "The page means 通う. 通 つう is the connoisseur, a different word that happens to share the character.",
  },
  {
    id: "6, 9, 10, 11, 12",
    knownRed: ["はたい"],
    text: "湯で汗を流し、しめくくりはたいてい緑茶を飲む。",
    bookmarks: [
      1436610 /* 締めくくる しめくくる v5r */, 1427900 /* 張る はる v5r */,
      1596830 /* 炊く たく v5k */, 1208230 /* 括る くくる v5r */, 1310000 /* 指名 しめい n,vs */,
      1320390 /* 湿る しめる v5r */, 1389460 /* 占める しめる v1 */, 1436570 /* 締める しめる v1 */,
      1200390 /* 悔い くい n */, 1279450 /* 杭 くい n */, 1322180 /* 射る いる v1 */,
      1552100 /* 流し ながし n */, 1400390 /* 巣 す n */, 2069220 /* 素 す n */,
    ],
    mustHighlight: ["しめくくり"],
    mustNotHighlight: [
      "はたい",
      "たいてい",
      "たいて",
      "くくり",
      "しめく",
      "しめ",
      "くく",
      "いて",
      "いてい",
      "し",
    ],
    undecided: ["流し"],
    note: "The densest run on the page. しめくくり is right, via the masu-stem of 締めくくる. Everything else is an inflection of a word that is not here — たいてい from 炊く, しめく from the adverbial of the noun 指名. 流し is unruled: the owner has the noun 流し bookmarked and not 流す, and here 流し is 流す's stem, which cuts opposite to 励み.",
  },
  {
    id: "5 (phase 0)",
    knownRed: ["おい", "しい"],
    text: "ネットでおいしい店を調べる。",
    bookmarks: [
      1432410 /* 追う おう v5u */, 1497930 /* 負う おう v5u */, 1378480 /* 生う おう v2h-k */,
      1560990 /* 老いる おいる v1 */, 1236100 /* 強いる しいる v1 */,
      1486650 /* 美味しい おいしい adj-i */,
    ],
    mustHighlight: [],
    mustNotHighlight: ["おい", "しい"],
    note: "Read as one box on the page, but it is two adjacent spans: おい from the masu-stem of 追う/負う/生う/老いる, しい from 強いる. Abutting spans have no gap, so they look like one highlight of おいしい — which is bookmarked by nobody here and would be suppressed by the kana guard anyway.",
  },
  {
    id: "2 (phase 0)",
    knownRed: ["緒"],
    text: "友達と一緒に出かける。",
    bookmarks: [1311470 /* 糸口/緒 いとぐち n */],
    mustHighlight: [],
    mustNotHighlight: ["緒"],
    note: "Read as 一緒 on the page. Only 緒 is painted, from 糸口/緒 matched as written. 一緒 itself is in no list.",
  },
  {
    id: "8",
    text: "岩盤浴に行ってみたい。",
    bookmarks: [1217400 /* 岩盤 がんばん n */, 1217270 /* 岩 いわ n */],
    mustHighlight: ["岩盤"],
    mustNotHighlight: ["岩"],
    note: "Accepted. The word on the page is 岩盤浴; marking 岩盤 inside it is fine. Longest-first must keep 岩 from winning.",
  },
  {
    id: "13",
    text: "夜更けまで話し込んだ。",
    bookmarks: [1606010 /* 夜更け よふけ n */],
    mustHighlight: ["夜更け"],
    mustNotHighlight: [],
    note: "Accepted. Exact, as written.",
  },
  {
    id: "14, 19",
    knownRed: ["とい"],
    text: "というより、むしろ逆だと思う。",
    bookmarks: [1013190 /* より prt */, 1446740 /* 塔 とう n */],
    mustHighlight: ["より"],
    mustNotHighlight: ["とい"],
    note: "より is correctly matched and bookmarked. とい is the masu-stem of the noun 塔 — an inflection a noun cannot take. Whether より is worth highlighting at all is a density question, not a correctness one.",
  },
  {
    id: "15",
    knownRed: ["からず"],
    text: "会ってからずっと喋っている。",
    bookmarks: [1209540 /* 刈る かる v5r */],
    mustHighlight: [],
    mustNotHighlight: ["からず"],
    note: "The text is から + ずっと. からず is a legal negative of 刈る straddling the boundary.",
  },
  {
    id: "16",
    knownRed: ["している"],
    text: "何をしている間も笑っていた。",
    bookmarks: [1335520 /* 汁 しる n */, 1400390 /* 巣 す n */, 2069220 /* 素 す n */],
    mustHighlight: [],
    mustNotHighlight: ["している", "してい", "して", "し"],
    note: "する conjugated, matched as inflections of the nouns 汁 and 巣 and 素. Nouns cannot take te-iru.",
  },
  {
    id: "17",
    knownRed: ["ひたすら", "ひた"],
    text: "朝からひたすら歩き続けた。",
    bookmarks: [1010530 /* 只管 ひたすら adv */, 1212010 /* 干る ひる v1 */],
    mustHighlight: ["ひたすら"],
    mustNotHighlight: ["ひた"],
    note: "The sharpest finding. ひたすら is bookmarked and matches exactly, then the kana guard drops it because 只管 is a kanji form the page did not use — leaving ひた, the past of 干る, to win. The guard removed the right answer and kept the wrong one.",
  },
  {
    id: "18",
    text: "何度見ても飽きない。",
    bookmarks: [1586250 /* 飽きる あきる v1 */],
    mustHighlight: ["飽きない"],
    mustNotHighlight: ["飽き"],
    note: "Accepted. The negative of a bookmarked verb, marked whole.",
  },
  {
    id: "18 (ruby)",
    html: "<p>何度見ても<ruby>飽<rt>あ</rt></ruby>きない。</p>",
    text: "何度見ても飽きない。",
    bookmarks: [1586250 /* 飽きる あきる v1 */],
    mustHighlight: ["飽きない"],
    mustNotHighlight: [],
    mustBeOneSpan: ["飽きない"],
    knownRedSeam: true,
    note: "Same span, with furigana on 飽. The renderer currently flushes the highlight chunk at every <rt>, so the one word is painted as 飽 + きない and shows a seam.",
  },
  {
    id: "20, 21",
    knownRed: ["く"],
    text: "年の差とは関係なく、互いに引かれあう。",
    bookmarks: [1268780 /* 互いに たがいに adv */, 1955830 /* 堰/井堰 せき/いせき/い n */],
    mustHighlight: ["互いに"],
    mustNotHighlight: ["く"],
    note: "互いに is accepted. く is the adverbial of the noun 堰, read as い — a noun taking an adjective inflection.",
  },
  {
    id: "22",
    knownRed: ["かし"],
    text: "何かしら理由があるのだろう。",
    bookmarks: [
      1195720 /* 課す かす v5s */, 1568780 /* 滓 かす n */, 1577030 /* 化す かす v5s */,
      2406900 /* 科す かす v5s */,
    ],
    mustHighlight: [],
    mustNotHighlight: ["かし"],
    note: "何かしら is one word. かし is a legal masu-stem of 課す/化す/科す, so part of speech does not settle this one — only the boundary does.",
  },
  {
    id: "23",
    knownRed: ["だち", "欲し", "かった"],
    text: "こういう女友だちが欲しかった。",
    bookmarks: [
      2601360 /* 脱 だつ pref */, 2410130 /* 欲す ほりす v5s */, 1208840 /* 且つ かつ conj */,
      1209540 /* 刈る かる v5r */, 1253900 /* 欠く かく v5k */, 1399970 /* 掻く かく v5k */,
      1547320 /* 欲 よく n */,
    ],
    mustHighlight: [],
    mustNotHighlight: ["だち", "欲し", "かった", "欲"],
    note: "だち is the masu-stem of the prefix 脱 — a prefix cannot inflect at all. 欲しかった is one word, 欲しい, which is not bookmarked; 欲し and かった each cut it in half.",
  },
  {
    id: "25",
    knownRed: ["わた"],
    text: "十数年にわたる結婚生活だった。",
    bookmarks: [1208000 /* 割る わる v5r */, 1580825 /* 数 すう pref,n,n-suf */],
    mustHighlight: [],
    mustNotHighlight: ["わた"],
    undecided: ["数"],
    note: "にわたる is one expression. わた is the past of 割る spanning its boundary. 数 inside 十数年 is unruled — the character is read すう there, so the match is not obviously wrong, only noisy.",
  },
  {
    id: "27",
    knownRed: ["きた", "して", "くて", "欲し"],
    text: "欲しくても我慢してきたものがある。",
    bookmarks: [
      1247040 /* 繰る くる v5r */, 1585570 /* 抉る くる v5r */, 1335520 /* 汁 しる n */,
      2410130 /* 欲す ほりす v5s */, 1309520 /* 思惟 しい n,vs */,
    ],
    mustHighlight: [],
    mustNotHighlight: ["きた", "して", "くて", "しくて", "しく", "欲し"],
    note: "我慢してきた is 我慢 + する + くる. きた is matched as the past of 繰る, して as the te-form of the noun 汁. しく and しくて come from adjective inflections applied to the noun 思惟.",
  },
  {
    id: "28",
    knownRed: ["はい", "く"],
    text: "我慢したものはいくつかあるだろう。",
    bookmarks: [
      1474200 /* 這う はう v5u */, 1955830 /* 堰/井堰 せき/いせき/い n */, 1201860 /* 灰 はい n */,
      2856718 /* 逝く いく v5k-s */,
    ],
    mustHighlight: [],
    mustNotHighlight: ["はい", "く"],
    note: "ものはいくつか is もの + は + いくつか. はい is the masu-stem of 這う across the particle; the next span is not 行く but く, the adverbial of the noun 堰.",
  },
  {
    id: "29",
    knownRed: ["けれ"],
    text: "面倒だけれど、やるしかない。",
    bookmarks: [1333400 /* 蹴る ける v5r */],
    mustHighlight: [],
    mustNotHighlight: ["けれ"],
    note: "けれど is a conjunction. けれ is the imperative of 蹴る.",
  },
  {
    id: "24",
    text: "帰りに店に寄った。",
    bookmarks: [1221270 /* 帰る かえる v5r */],
    mustHighlight: ["帰り"],
    mustNotHighlight: [],
    note: "Correct, and not among the walked spans. Kept as a guard: the masu-stem of a bookmarked verb used as a noun is exactly what the feature is for, and a boundary fix must not take it.",
  },
];
