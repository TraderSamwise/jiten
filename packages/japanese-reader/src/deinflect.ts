import { toHiragana } from "wanakana";

// ─── POS type bitmasks ───
// These constrain which deinflection rules can apply to which word types
const V1 = 1; // ichidan verb
const V5 = 2; // godan verb
const ADJ = 4; // i-adjective
const SURU = 8; // suru verb
const KURU = 16; // kuru verb
const IKU = 32; // iku verb (special te-form)

/**
 * Undoing ～ておく is a guess about a contraction, so the lookup lets a reading
 * that needs no guess win first: かいときました is 書いとく, an entry of its own,
 * and must not be answered with 買い手.
 */
export const TE_OKU_REASON = "te-oku (casual)";
/** Same rule for ～ちゃう / ～じゃう, the contraction of ～てしまう / ～でしまう. */
export const TE_SHIMAU_REASON = "te-shimau (casual)";
/** Undoing any of these is a guess; a reading that needs no guess wins first. */
export const CONTRACTION_REASONS: ReadonlySet<string> = new Set([TE_OKU_REASON, TE_SHIMAU_REASON]);
const ANY = 0xff;
/**
 * Everything but a godan verb. The masu-stem rules type their output V5, so a
 * contraction rule carrying this cannot latch onto one: without it 云っちゃい
 * became 云っちゃう and then 言う, swallowing the いけない of 云っちゃいけない,
 * which is ～てはいけない and a different contraction entirely.
 */
const NOT_MASU_STEM = ANY & ~V5;

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
  /** Minimum stem length left after stripping `from`. Guards 1-char inputs. */
  minStem?: number;
}

// ─── Deinflection rules ───
// Modeled on rikaikun/10ten-ja-reader/yomichan deinflect.dat
const RULES: DeinflectRule[] = [
  // ── Ichidan (る-verbs) ──
  { from: "て", to: "る", typeIn: V1, typeOut: V1, reason: "te-form" },
  { from: "た", to: "る", typeIn: V1, typeOut: V1, reason: "past" },
  { from: "ない", to: "る", typeIn: V1, typeOut: V1, reason: "negative" },
  { from: "なかった", to: "る", typeIn: V1, typeOut: V1, reason: "negative past" },
  { from: "なければ", to: "る", typeIn: V1, typeOut: V1, reason: "negative conditional" },
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
  { from: "わなければ", to: "う", typeIn: V5, typeOut: V5, reason: "negative conditional" },
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
  { from: "かなければ", to: "く", typeIn: V5, typeOut: V5, reason: "negative conditional" },
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
  { from: "がなければ", to: "ぐ", typeIn: V5, typeOut: V5, reason: "negative conditional" },
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
  { from: "さなければ", to: "す", typeIn: V5, typeOut: V5, reason: "negative conditional" },
  { from: "します", to: "す", typeIn: V5, typeOut: V5, reason: "polite" },
  { from: "しました", to: "す", typeIn: V5, typeOut: V5, reason: "past polite" },
  { from: "しません", to: "す", typeIn: V5, typeOut: V5, reason: "negative polite" },
  { from: "せる", to: "す", typeIn: V5_OR_V1, typeOut: V5, reason: "potential" },
  { from: "される", to: "す", typeIn: V5_OR_V1, typeOut: V5, reason: "passive" },
  { from: "され", to: "す", typeIn: V5_OR_V1, typeOut: V5, reason: "passive stem" },
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
  { from: "たなければ", to: "つ", typeIn: V5, typeOut: V5, reason: "negative conditional" },
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
  { from: "ななければ", to: "ぬ", typeIn: V5, typeOut: V5, reason: "negative conditional" },
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
  { from: "ばなければ", to: "ぶ", typeIn: V5, typeOut: V5, reason: "negative conditional" },
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
  { from: "まなければ", to: "む", typeIn: V5, typeOut: V5, reason: "negative conditional" },
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
  { from: "らなければ", to: "る", typeIn: V5, typeOut: V5, reason: "negative conditional" },
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
  { from: "しなければ", to: "する", typeIn: SURU, typeOut: SURU, reason: "negative conditional" },
  { from: "します", to: "する", typeIn: SURU, typeOut: SURU, reason: "polite" },
  { from: "しました", to: "する", typeIn: SURU, typeOut: SURU, reason: "past polite" },
  { from: "しません", to: "する", typeIn: SURU, typeOut: SURU, reason: "negative polite" },
  { from: "できる", to: "する", typeIn: SURU_OR_V1, typeOut: SURU, reason: "potential" },
  { from: "せられる", to: "する", typeIn: SURU_OR_V1, typeOut: SURU, reason: "passive" },
  { from: "される", to: "する", typeIn: SURU_OR_V1, typeOut: SURU, reason: "passive" },
  { from: "され", to: "する", typeIn: SURU_OR_V1, typeOut: SURU, reason: "passive stem" },
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
  { from: "こなければ", to: "くる", typeIn: KURU, typeOut: KURU, reason: "negative conditional" },
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
  { from: "来なければ", to: "来る", typeIn: KURU, typeOut: KURU, reason: "negative conditional" },
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
  // 恥ずかしそう "looks embarrassed". Shares its ending with the godan
  // volitional 話そう below; both rules are tried and the dictionary decides.
  { from: "そう", to: "い", typeIn: ADJ, typeOut: ADJ, reason: "appearance" },
  // ── Negative ～ず / ～ずに (written negative, the ～ない of literary prose) ──
  { from: "ずに", to: "ず", typeIn: ANY, typeOut: ANY, reason: "without doing" },
  { from: "ず", to: "る", typeIn: V1, typeOut: V1, reason: "negative", minStem: 1 },
  { from: "わず", to: "う", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "かず", to: "く", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "がず", to: "ぐ", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "さず", to: "す", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "たず", to: "つ", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "なず", to: "ぬ", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "ばず", to: "ぶ", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "まず", to: "む", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "らず", to: "る", typeIn: V5, typeOut: V5, reason: "negative" },
  { from: "せず", to: "する", typeIn: SURU, typeOut: SURU, reason: "negative" },
  { from: "こず", to: "くる", typeIn: KURU, typeOut: KURU, reason: "negative" },

  // ── Generic te-iru forms (works across verb types after te-form resolution) ──
  { from: "ている", to: "て", typeIn: ANY, typeOut: ANY, reason: "te-iru" },
  { from: "てる", to: "て", typeIn: ANY, typeOut: ANY, reason: "te-iru (casual)" },
  { from: "でいる", to: "で", typeIn: ANY, typeOut: ANY, reason: "te-iru" },
  { from: "でる", to: "で", typeIn: ANY, typeOut: ANY, reason: "te-iru (casual)" },

  // ── ～とく / ～どく: the spoken contraction of ～ておく ──
  // Rewritten to the te-form so the rules above finish the job: 置いとく → 置いて
  // → 置く. The te-stem kana is part of the pattern rather than left to minStem,
  // because a bare ～とく also matches the output of the masu-stem rules and turns
  // のとき into 乗る and 行くとき into 行い.
  { from: "いとく", to: "いて", typeIn: ANY, typeOut: V5, reason: TE_OKU_REASON },
  { from: "っとく", to: "って", typeIn: ANY, typeOut: V5, reason: TE_OKU_REASON },
  { from: "んどく", to: "んで", typeIn: ANY, typeOut: V5, reason: TE_OKU_REASON },
  // An ichidan te-form is just the stem plus て, so ～とく sits straight on the
  // stem: 見とく, 食べとく. typeIn V1 is what keeps this off the masu-stem rules'
  // output, which they type V5 — that path is how のとき reached 乗る.
  { from: "とく", to: "て", typeIn: V1, typeOut: V1, reason: TE_OKU_REASON, minStem: 1 },

  // ── ～ちゃう / ～じゃう: the spoken contraction of ～てしまう ──
  // Same shape and the same reason for it as ～とく above: the te-stem kana is in
  // the pattern so a bare ～ちゃう cannot latch onto another rule's output.
  { from: "っちゃう", to: "って", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "いちゃう", to: "いて", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "いじゃう", to: "いで", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "しちゃう", to: "して", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "んじゃう", to: "んで", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "ちゃう", to: "て", typeIn: V1, typeOut: V1, reason: TE_SHIMAU_REASON, minStem: 1 },

  // ～ちゃう's own past and te-form, spelled out. Reaching them by chaining
  // through the past rule would mean letting a masu-stem through too, and
  // ～ちゃい is 云っちゃいけない — ～てはいけない, a different contraction.
  { from: "っちゃった", to: "って", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "っちゃって", to: "って", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "いちゃった", to: "いて", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "いちゃって", to: "いて", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "いじゃった", to: "いで", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "いじゃって", to: "いで", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "しちゃった", to: "して", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "しちゃって", to: "して", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "んじゃった", to: "んで", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "んじゃって", to: "んで", typeIn: NOT_MASU_STEM, typeOut: V5, reason: TE_SHIMAU_REASON },
  { from: "ちゃった", to: "て", typeIn: V1, typeOut: V1, reason: TE_SHIMAU_REASON, minStem: 1 },
  { from: "ちゃって", to: "て", typeIn: V1, typeOut: V1, reason: TE_SHIMAU_REASON, minStem: 1 },

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

  // ── Ichidan masu-stem / 連用形 as a standalone form ──
  // The godan half of this is above (き→く, り→る…); the ichidan half was
  // missing, so 見上げ、/ くたびれ、— a 連用形 used to join clauses, everywhere in
  // prose — resolved to nothing and the tap fell back to a fragment (上げ).
  // Only え/い-row endings can be an ichidan stem, and minStem keeps a bare
  // one-kana word from inventing a verb.
  { from: "え", to: "える", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "け", to: "ける", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "げ", to: "げる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "せ", to: "せる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "ぜ", to: "ぜる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "て", to: "てる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "で", to: "でる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "ね", to: "ねる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "へ", to: "へる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "べ", to: "べる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "ぺ", to: "ぺる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "め", to: "める", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "れ", to: "れる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "い", to: "いる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "き", to: "きる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "ぎ", to: "ぎる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "し", to: "しる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "じ", to: "じる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "ち", to: "ちる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "ぢ", to: "ぢる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "に", to: "にる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "ひ", to: "ひる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "び", to: "びる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "ぴ", to: "ぴる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "み", to: "みる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
  { from: "り", to: "りる", typeIn: V1, typeOut: V1, reason: "masu-stem", minStem: 1 },
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
      if (rule.minStem != null && stemLen < rule.minStem) continue;
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
const MAX_KANA_SPELLINGS = 8;
/**
 * Below this a rewritten span is not a phrase, just a short kana string that
 * collides with something: 気が becomes きが, the common word 飢餓; 中から
 * becomes ちゅうから, 中辛; が死ん becomes がしん.
 */
const MIN_KANA_SPELLING_LENGTH = 4;

function isSpellingKanji(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

/**
 * The same text with its single kanji rewritten as that kanji's reading.
 *
 * A book may spell one word of a set phrase in kana — 気を持たせる written
 * 気をもたせる — which matches neither the entry's kanji form nor its kana form
 * きをもたせる. Rewriting the one kanji that is left bridges the two.
 *
 * Only ever one kanji, because a span with two is not the case this is for and
 * the combinations multiply; and only spans long enough to be a phrase, because
 * rewriting 気が gives きが, which is the common word 飢餓.
 *
 * `readings` come from KANJIDIC, where a dot separates the kanji's own reading
 * from the okurigana that follows it and a leading hyphen marks a suffix
 * reading: 持 is "も.つ", of which only も belongs to the kanji.
 */
export function kanaSpellings(
  text: string,
  readings: readonly string[],
): { literal: string; spellings: string[] } {
  const none = { literal: "", spellings: [] as string[] };
  const chars = [...text];
  if (chars.length < MIN_KANA_SPELLING_LENGTH) return none;

  let kanjiAt = -1;
  for (let i = 0; i < chars.length; i++) {
    if (!isSpellingKanji(chars[i])) continue;
    if (kanjiAt !== -1) return none;
    kanjiAt = i;
  }
  if (kanjiAt === -1) return none;

  const spellings: string[] = [];
  const seen = new Set<string>([text]);
  for (const reading of readings) {
    // "-も.ち" is a suffix reading of 持 whose okurigana is ち; "あい-" is a
    // prefix reading. Only the part between the markers is the kanji's own.
    const bare = toHiragana(reading.replace(/^-|-$/g, "").split(".")[0]).trim();
    if (!bare) continue;
    const spelled = [...chars.slice(0, kanjiAt), bare, ...chars.slice(kanjiAt + 1)].join("");
    if (seen.has(spelled)) continue;
    seen.add(spelled);
    spellings.push(spelled);
    if (spellings.length >= MAX_KANA_SPELLINGS) break;
  }
  return { literal: chars[kanjiAt], spellings };
}

/**
 * Particles a set phrase swaps without becoming a different phrase. が, は and
 * も trade places as subject, topic and emphasis; に and へ both mark a goal;
 * and が becomes の on the subject of a relative clause, which is why the entry
 * 目の玉が飛び出る appears in a book as 目の玉の飛び出る.
 *
 * The map runs text -> dictionary, so the の entry is the text's spelling and
 * が the entry's. を, で, と and から are absent because swapping those changes
 * the case rather than the register.
 */
const PARTICLE_ALTERNATIVES: Record<string, string> = {
  の: "が",
  が: "はも",
  は: "がも",
  も: "がは",
  に: "へ",
  へ: "に",
};

/** Below this a swap invents a word rather than recovering one — see below. */
const MIN_PARTICLE_VARIANT_LENGTH = 4;

/**
 * The text with one particle replaced by an equivalent, one variant per swap.
 *
 * Only one particle moves at a time: a phrase needing two simultaneous
 * substitutions is not one worth guessing at, and the combinations multiply
 * against a walk that already tries ~120 substrings per tap.
 *
 * Short spans are refused outright. のか swapped is がか, the common noun 画家;
 * はい is がい, which is 害, 街 and 外. Over the corpus, swapping without a
 * length floor put 1161 spans on a real entry, 240 of them common.
 */
export function particleVariants(text: string): string[] {
  const chars = [...text];
  if (chars.length < MIN_PARTICLE_VARIANT_LENGTH) return [];
  // A phrase worth recovering is anchored by a kanji. Without this the walk
  // guesses at every run of kana it passes — 200 extra dictionary reads per
  // tap, none of them cacheable — and mis-cuts spans out of ordinary grammar,
  // reading でもないから as でもないか.
  if (!chars.some(isSpellingKanji)) return [];

  const out: string[] = [];
  const seen = new Set<string>([text]);
  // From 1: a particle in first position governs the phrase before this span,
  // not this one. Swapping it read 宿屋へ連れて来た, "brought me to the inn",
  // as につれて, "as it progressed".
  for (let i = 1; i < chars.length; i++) {
    const alternatives = PARTICLE_ALTERNATIVES[chars[i]];
    if (!alternatives) continue;
    for (const alternative of alternatives) {
      const swapped = [...chars];
      swapped[i] = alternative;
      const variant = swapped.join("");
      if (seen.has(variant)) continue;
      seen.add(variant);
      out.push(variant);
    }
  }
  return out;
}

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
