// ─── POS type bitmasks ───
// These constrain which deinflection rules can apply to which word types
const V1 = 1; // ichidan verb
const V5 = 2; // godan verb
const ADJ = 4; // i-adjective
const SURU = 8; // suru verb
const KURU = 16; // kuru verb
const IKU = 32; // iku verb (special te-form)
const ANY = 0xff;

// Passive, causative, and potential forms are themselves ichidan verbs.
// When they conjugate (past, negative, etc.), the V1 deinflection strips
// the conjugation and outputs V1. The next step must still recognize the
// passive/causative/potential ending, so these rules accept V1 as well.
const V5_OR_V1 = V5 | V1;
const SURU_OR_V1 = SURU | V1;
const KURU_OR_V1 = KURU | V1;

interface DeinflectRule {
  from: string;
  to: string;
  typeIn: number;
  typeOut: number;
  reason: string;
}

// ─── Deinflection rules ───
// Modeled on rikaikun/10ten-ja-reader/yomichan deinflect.dat
const RULES: DeinflectRule[] = [
  // ── Ichidan (る-verbs) ──
  { from: "て", to: "る", typeIn: V1, typeOut: V1, reason: "te-form" },
  { from: "た", to: "る", typeIn: V1, typeOut: V1, reason: "past" },
  { from: "ない", to: "る", typeIn: V1, typeOut: V1, reason: "negative" },
  { from: "なかった", to: "る", typeIn: V1, typeOut: V1, reason: "negative past" },
  { from: "ます", to: "る", typeIn: V1, typeOut: V1, reason: "polite" },
  { from: "ました", to: "る", typeIn: V1, typeOut: V1, reason: "past polite" },
  { from: "ません", to: "る", typeIn: V1, typeOut: V1, reason: "negative polite" },
  { from: "ませんでした", to: "る", typeIn: V1, typeOut: V1, reason: "negative past polite" },
  { from: "られる", to: "る", typeIn: V1, typeOut: V1, reason: "passive/potential" },
  { from: "させる", to: "る", typeIn: V1, typeOut: V1, reason: "causative" },
  { from: "させられる", to: "る", typeIn: V1, typeOut: V1, reason: "causative passive" },
  { from: "ろ", to: "る", typeIn: V1, typeOut: V1, reason: "imperative" },
  { from: "よう", to: "る", typeIn: V1, typeOut: V1, reason: "volitional" },
  { from: "れば", to: "る", typeIn: V1, typeOut: V1, reason: "conditional" },
  { from: "たら", to: "る", typeIn: V1, typeOut: V1, reason: "conditional" },
  { from: "たり", to: "る", typeIn: V1, typeOut: V1, reason: "tari" },
  { from: "ている", to: "る", typeIn: V1, typeOut: V1, reason: "te-iru" },
  { from: "てる", to: "る", typeIn: V1, typeOut: V1, reason: "te-iru (casual)" },

  // ── Godan (う-verbs): う-column ──
  { from: "った", to: "う", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "って", to: "う", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "わない", to: "う", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "わなかった", to: "う", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "います", to: "う", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "いました", to: "う", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "いません", to: "う", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "える", to: "う", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "われる", to: "う", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "わせる", to: "う", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "え", to: "う", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "おう", to: "う", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "えば", to: "う", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "ったら", to: "う", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "ったり", to: "う", typeIn: V5, typeOut: V5, reason: "tari" },

  // く-column
  { from: "いた", to: "く", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "いて", to: "く", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "かない", to: "く", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "かなかった", to: "く", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "きます", to: "く", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "きました", to: "く", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "きません", to: "く", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "ける", to: "く", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "かれる", to: "く", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "かせる", to: "く", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "け", to: "く", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "こう", to: "く", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "けば", to: "く", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "いたら", to: "く", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "いたり", to: "く", typeIn: V5, typeOut: V5, reason: "tari" },

  // ぐ-column
  { from: "いだ", to: "ぐ", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "いで", to: "ぐ", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "がない", to: "ぐ", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "がなかった", to: "ぐ", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "ぎます", to: "ぐ", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "ぎました", to: "ぐ", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "ぎません", to: "ぐ", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "げる", to: "ぐ", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "がれる", to: "ぐ", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "がせる", to: "ぐ", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "げ", to: "ぐ", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "ごう", to: "ぐ", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "げば", to: "ぐ", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "いだら", to: "ぐ", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "いだり", to: "ぐ", typeIn: V5, typeOut: V5, reason: "tari" },

  // す-column
  { from: "した", to: "す", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "して", to: "す", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "さない", to: "す", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "さなかった", to: "す", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "します", to: "す", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "しました", to: "す", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "しません", to: "す", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "せる", to: "す", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "される", to: "す", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "させる", to: "す", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "せ", to: "す", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "そう", to: "す", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "せば", to: "す", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "したら", to: "す", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "したり", to: "す", typeIn: V5, typeOut: V5, reason: "tari" },

  // つ-column
  { from: "った", to: "つ", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "って", to: "つ", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "たない", to: "つ", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "たなかった", to: "つ", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "ちます", to: "つ", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "ちました", to: "つ", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "ちません", to: "つ", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "てる", to: "つ", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "たれる", to: "つ", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "たせる", to: "つ", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "て", to: "つ", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "とう", to: "つ", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "てば", to: "つ", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "ったら", to: "つ", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "ったり", to: "つ", typeIn: V5, typeOut: V5, reason: "tari" },

  // ぬ-column
  { from: "んだ", to: "ぬ", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "んで", to: "ぬ", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "なない", to: "ぬ", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "ななかった", to: "ぬ", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "にます", to: "ぬ", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "にました", to: "ぬ", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "にません", to: "ぬ", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "ねる", to: "ぬ", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "なれる", to: "ぬ", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "なせる", to: "ぬ", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "ね", to: "ぬ", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "のう", to: "ぬ", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "ねば", to: "ぬ", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "んだら", to: "ぬ", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "んだり", to: "ぬ", typeIn: V5, typeOut: V5, reason: "tari" },

  // ぶ-column
  { from: "んだ", to: "ぶ", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "んで", to: "ぶ", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "ばない", to: "ぶ", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "ばなかった", to: "ぶ", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "びます", to: "ぶ", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "びました", to: "ぶ", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "びません", to: "ぶ", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "べる", to: "ぶ", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "ばれる", to: "ぶ", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "ばせる", to: "ぶ", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "べ", to: "ぶ", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "ぼう", to: "ぶ", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "べば", to: "ぶ", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "んだら", to: "ぶ", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "んだり", to: "ぶ", typeIn: V5, typeOut: V5, reason: "tari" },

  // む-column
  { from: "んだ", to: "む", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "んで", to: "む", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "まない", to: "む", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "まなかった", to: "む", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "みます", to: "む", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "みました", to: "む", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "みません", to: "む", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "める", to: "む", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "まれる", to: "む", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "ませる", to: "む", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "め", to: "む", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "もう", to: "む", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "めば", to: "む", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "んだら", to: "む", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "んだり", to: "む", typeIn: V5, typeOut: V5, reason: "tari" },

  // る-column (godan る-verbs, not ichidan)
  { from: "った", to: "る", typeIn: V5, typeOut: V5, reason: "past" },
  { from: "って", to: "る", typeIn: V5, typeOut: V5, reason: "te-form" },
  { from: "らない", to: "る", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "らなかった", to: "る", typeIn: V5, typeOut: V5, reason: "negative past" },
  { from: "ります", to: "る", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "りました", to: "る", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "りません", to: "る", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "れる", to: "る", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "られる", to: "る", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "らせる", to: "る", typeIn: V5_OR_V1, typeOut: V5, reason: "causative" },
  { from: "れ", to: "る", typeIn: V5, typeOut: V5, reason: "imperative" },
  { from: "ろう", to: "る", typeIn: V5, typeOut: V5, reason: "volitional" },
  { from: "れば", to: "る", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "ったら", to: "る", typeIn: V5, typeOut: V5, reason: "conditional" },
  { from: "ったり", to: "る", typeIn: V5, typeOut: V5, reason: "tari" },

  // ── 行く special (いった/いって instead of いいた/いいて) ──
  { from: "った", to: "く", typeIn: IKU, typeOut: IKU, reason: "past" },
  { from: "って", to: "く", typeIn: IKU, typeOut: IKU, reason: "te-form" },
  { from: "ったら", to: "く", typeIn: IKU, typeOut: IKU, reason: "conditional" },
  { from: "ったり", to: "く", typeIn: IKU, typeOut: IKU, reason: "tari" },

  // ── する (suru) irregular ──
  { from: "した", to: "する", typeIn: SURU, typeOut: SURU, reason: "past" },
  { from: "して", to: "する", typeIn: SURU, typeOut: SURU, reason: "te-form" },
  { from: "しない", to: "する", typeIn: SURU, typeOut: SURU, reason: "negative" },
  { from: "しなかった", to: "する", typeIn: SURU, typeOut: SURU, reason: "negative past" },
  { from: "します", to: "する", typeIn: SURU, typeOut: SURU, reason: "polite" },
  { from: "しました", to: "する", typeIn: SURU, typeOut: SURU, reason: "past polite" },
  { from: "しません", to: "する", typeIn: SURU, typeOut: SURU, reason: "negative polite" },
  { from: "できる", to: "する", typeIn: SURU_OR_V1, typeOut: SURU, reason: "potential" },
  { from: "される", to: "する", typeIn: SURU_OR_V1, typeOut: SURU, reason: "passive" },
  { from: "させる", to: "する", typeIn: SURU_OR_V1, typeOut: SURU, reason: "causative" },
  { from: "しろ", to: "する", typeIn: SURU, typeOut: SURU, reason: "imperative" },
  { from: "せよ", to: "する", typeIn: SURU, typeOut: SURU, reason: "imperative" },
  { from: "しよう", to: "する", typeIn: SURU, typeOut: SURU, reason: "volitional" },
  { from: "すれば", to: "する", typeIn: SURU, typeOut: SURU, reason: "conditional" },
  { from: "したら", to: "する", typeIn: SURU, typeOut: SURU, reason: "conditional" },
  { from: "したり", to: "する", typeIn: SURU, typeOut: SURU, reason: "tari" },
  { from: "している", to: "する", typeIn: SURU, typeOut: SURU, reason: "te-iru" },
  { from: "してる", to: "する", typeIn: SURU, typeOut: SURU, reason: "te-iru (casual)" },
  { from: "する", to: "", typeIn: SURU, typeOut: ANY, reason: "suru-verb noun" },

  // ── 来る (kuru) irregular ──
  { from: "きた", to: "くる", typeIn: KURU, typeOut: KURU, reason: "past" },
  { from: "きて", to: "くる", typeIn: KURU, typeOut: KURU, reason: "te-form" },
  { from: "こない", to: "くる", typeIn: KURU, typeOut: KURU, reason: "negative" },
  { from: "こなかった", to: "くる", typeIn: KURU, typeOut: KURU, reason: "negative past" },
  { from: "きます", to: "くる", typeIn: KURU, typeOut: KURU, reason: "polite" },
  { from: "きました", to: "くる", typeIn: KURU, typeOut: KURU, reason: "past polite" },
  { from: "きません", to: "くる", typeIn: KURU, typeOut: KURU, reason: "negative polite" },
  { from: "こられる", to: "くる", typeIn: KURU_OR_V1, typeOut: KURU, reason: "potential" },
  { from: "こられる", to: "くる", typeIn: KURU_OR_V1, typeOut: KURU, reason: "passive" },
  { from: "こさせる", to: "くる", typeIn: KURU_OR_V1, typeOut: KURU, reason: "causative" },
  { from: "こい", to: "くる", typeIn: KURU, typeOut: KURU, reason: "imperative" },
  { from: "こよう", to: "くる", typeIn: KURU, typeOut: KURU, reason: "volitional" },
  { from: "くれば", to: "くる", typeIn: KURU, typeOut: KURU, reason: "conditional" },
  { from: "きたら", to: "くる", typeIn: KURU, typeOut: KURU, reason: "conditional" },
  { from: "きたり", to: "くる", typeIn: KURU, typeOut: KURU, reason: "tari" },
  { from: "きている", to: "くる", typeIn: KURU, typeOut: KURU, reason: "te-iru" },
  { from: "きてる", to: "くる", typeIn: KURU, typeOut: KURU, reason: "te-iru (casual)" },

  // ── 来る kanji forms ──
  { from: "来た", to: "来る", typeIn: KURU, typeOut: KURU, reason: "past" },
  { from: "来て", to: "来る", typeIn: KURU, typeOut: KURU, reason: "te-form" },
  { from: "来ない", to: "来る", typeIn: KURU, typeOut: KURU, reason: "negative" },
  { from: "来ます", to: "来る", typeIn: KURU, typeOut: KURU, reason: "polite" },
  { from: "来ました", to: "来る", typeIn: KURU, typeOut: KURU, reason: "past polite" },
  { from: "来ません", to: "来る", typeIn: KURU, typeOut: KURU, reason: "negative polite" },

  // ── i-adjective ──
  { from: "くない", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "negative" },
  { from: "くもない", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "negative" },
  { from: "くなかった", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "negative past" },
  { from: "くもなかった", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "negative past" },
  { from: "かった", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "past" },
  { from: "くて", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "te-form" },
  { from: "く", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "adverbial" },
  { from: "ければ", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "conditional" },
  { from: "かろう", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "volitional" },
  { from: "さ", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "nominalization" },

  // ── Generic te-iru forms (works across verb types after te-form resolution) ──
  { from: "ている", to: "て", typeIn: ANY, typeOut: ANY, reason: "te-iru" },
  { from: "てる", to: "て", typeIn: ANY, typeOut: ANY, reason: "te-iru (casual)" },
  { from: "でいる", to: "で", typeIn: ANY, typeOut: ANY, reason: "te-iru" },
  { from: "でる", to: "で", typeIn: ANY, typeOut: ANY, reason: "te-iru (casual)" },

  // ── たい (want to) ── applies to masu-stem, which looks like ichidan
  { from: "たい", to: "る", typeIn: V1, typeOut: V1, reason: "tai (want)" },
  { from: "たくない", to: "る", typeIn: V1, typeOut: V1, reason: "tai negative" },
  { from: "たかった", to: "る", typeIn: V1, typeOut: V1, reason: "tai past" },

  // ── Godan masu-stem as standalone (noun form) ──
  { from: "い", to: "う", typeIn: V5, typeOut: V5, reason: "masu-stem" },
  { from: "き", to: "く", typeIn: V5, typeOut: V5, reason: "masu-stem" },
  { from: "ぎ", to: "ぐ", typeIn: V5, typeOut: V5, reason: "masu-stem" },
  { from: "し", to: "す", typeIn: V5, typeOut: V5, reason: "masu-stem" },
  { from: "ち", to: "つ", typeIn: V5, typeOut: V5, reason: "masu-stem" },
  { from: "に", to: "ぬ", typeIn: V5, typeOut: V5, reason: "masu-stem" },
  { from: "び", to: "ぶ", typeIn: V5, typeOut: V5, reason: "masu-stem" },
  { from: "み", to: "む", typeIn: V5, typeOut: V5, reason: "masu-stem" },
  { from: "り", to: "る", typeIn: V5, typeOut: V5, reason: "masu-stem" },
];

// ─── Deinflection algorithm ───

export interface DeinflectCandidate {
  word: string;
  typeMask: number;
  reasons: string[];
}

export function deinflect(word: string): DeinflectCandidate[] {
  const results: DeinflectCandidate[] = [{ word, typeMask: ANY, reasons: [] }];
  const seen = new Set([word]);

  for (let i = 0; i < results.length; i++) {
    const current = results[i];
    for (const rule of RULES) {
      if (!current.word.endsWith(rule.from)) continue;
      const stemLen = current.word.length - rule.from.length;
      if (stemLen + rule.to.length <= 0) continue;
      if (!(current.typeMask & rule.typeIn)) continue;

      const base = current.word.slice(0, stemLen) + rule.to;
      if (seen.has(base)) continue;
      seen.add(base);
      results.push({
        word: base,
        typeMask: rule.typeOut,
        reasons: [...current.reasons, rule.reason],
      });
    }
  }
  return results;
}

// ─── Substring generation (pure) ───

/**
 * Generates substrings to try for dictionary lookup, from longest to shortest.
 * Given text extracted from a tap position, we try progressively shorter
 * prefixes (up to maxLen chars) to find the longest matching word.
 */
export function generateSubstrings(text: string, maxLen: number = 15): string[] {
  const len = Math.min(text.length, maxLen);
  const result: string[] = [];
  for (let i = len; i >= 1; i--) {
    result.push(text.slice(0, i));
  }
  return result;
}

// ─── Lookup candidate generation (pure) ───

export interface LookupCandidate {
  /** The original substring from the text */
  matchedText: string;
  /** The deinflected dictionary-form word to search */
  searchWord: string;
  /** Chain of deinflection reasons (empty if unchanged) */
  reasons: string[];
}

/**
 * For a given text (from tap position forward), generates all candidate
 * words to look up in the dictionary. Tries progressively shorter substrings,
 * each deinflected into all possible base forms.
 *
 * This is a pure function — the actual dictionary lookup is separate.
 */
export function generateLookupCandidates(text: string, maxLen: number = 15): LookupCandidate[] {
  const substrings = generateSubstrings(text, maxLen);
  const candidates: LookupCandidate[] = [];
  const seen = new Set<string>();

  for (const substr of substrings) {
    const deinflected = deinflect(substr);
    for (const candidate of deinflected) {
      const key = `${substr}:${candidate.word}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        matchedText: substr,
        searchWord: candidate.word,
        reasons: candidate.reasons,
      });
    }
  }

  return candidates;
}
