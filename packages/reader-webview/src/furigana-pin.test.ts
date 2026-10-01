/**
 * @vitest-environment jsdom
 *
 * A pinned reading is keyed on the kanji run the user pressed, so these two
 * functions decide what gets pinned. Getting the run wrong pins a reading the
 * page will never match again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_RUN_LENGTH, kanjiRunAt, pressedRunAt, rubyUnder } from "./furigana-pin";
import { state } from "./state";
import { setupTouchHandlers } from "./touch";

describe("kanjiRunAt", () => {
  const text = "クッションを敷きこんで、杏子は３日待った。";

  it("finds the run from anywhere inside it", () => {
    // 杏子 is at 12..13.
    expect(kanjiRunAt(text, 12)).toBe("杏子");
    expect(kanjiRunAt(text, 13)).toBe("杏子");
  });

  it("stops at kana on either side", () => {
    expect(kanjiRunAt(text, 6)).toBe("敷");
    expect(kanjiRunAt("毎朝ウォーキングに励み", 1)).toBe("毎朝");
  });

  it("has nothing to say about a character that is not kanji", () => {
    expect(kanjiRunAt(text, 0)).toBe("");
    expect(kanjiRunAt("ひらがなだけ", 2)).toBe("");
    expect(kanjiRunAt("、", 0)).toBe("");
  });

  /** ３日 is a counter, and its reading belongs to the digit too. */
  it("keeps digits in the run", () => {
    expect(kanjiRunAt("3日で終わる", 0)).toBe("3日");
    expect(kanjiRunAt("3日で終わる", 1)).toBe("3日");
  });

  /**
   * The run is every kanji and digit that touch, so ３日待った reports ３日待 —
   * not a word, and not what the furigana annotated either. That is the
   * fallback, used only where the page carries no ruby; where it does,
   * `rubyUnder` reports the exact base the reader itself chose.
   */
  it("runs through a kanji the reader would have split off", () => {
    expect(kanjiRunAt(text, 15)).toBe("３日待");
    expect(kanjiRunAt(text, 17)).toBe("３日待");
  });

  it("stays inside the string", () => {
    expect(kanjiRunAt("杏子", -1)).toBe("");
    expect(kanjiRunAt("杏子", 2)).toBe("");
    expect(kanjiRunAt("", 0)).toBe("");
  });

  /** A long press on a long compound reports the part it landed on. */
  it("caps a very long run around the pressed character", () => {
    const long = "大日本帝国憲法第九条";
    expect(kanjiRunAt(long, 0)).toBe("大日本帝国憲法第");
    expect(kanjiRunAt(long, 9)).toBe("本帝国憲法第九条");
    expect(kanjiRunAt(long, 5)).toHaveLength(MAX_RUN_LENGTH);
    expect(kanjiRunAt(long, 5)).toContain("憲");
  });
});

describe("rubyUnder", () => {
  function render(html: string): Element {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  }

  it("reads the base and the reading from the ruby a press landed in", () => {
    const ruby = render("<ruby>杏子<rt>きょうこ</rt></ruby>");
    expect(rubyUnder(ruby)).toEqual({ run: "杏子", currentReading: "きょうこ" });
  });

  it("finds the ruby from a press on the reading itself", () => {
    render("<ruby>杏子<rt>きょうこ</rt></ruby>");
    const rt = document.querySelector("rt")!;
    expect(rubyUnder(rt)).toEqual({ run: "杏子", currentReading: "きょうこ" });
  });

  /** An EPUB writes the fallback parentheses a browser without ruby shows. */
  it("leaves the rp fallback parentheses out of both", () => {
    const ruby = render("<ruby>杏子<rp>(</rp><rt>きょうこ</rt><rp>)</rp></ruby>");
    expect(rubyUnder(ruby)).toEqual({ run: "杏子", currentReading: "きょうこ" });
  });

  it("has nothing to say outside a ruby", () => {
    const p = render("<p>杏子は帰った</p>");
    expect(rubyUnder(p)).toBeNull();
    expect(rubyUnder(null)).toBeNull();
  });

  it("refuses a ruby with no base text", () => {
    const ruby = render("<ruby><rt>きょうこ</rt></ruby>");
    expect(rubyUnder(ruby)).toBeNull();
  });
});

describe("pressedRunAt", () => {
  function pressOn(html: string): ReturnType<typeof pressedRunAt> {
    document.body.innerHTML = `<div id="page">${html}</div>`;
    state.pageEl = document.getElementById("page");
    state.contentEl = state.pageEl;
    // jsdom has no layout; the press is told which character it landed on.
    const target = document.querySelector("[data-press]") as HTMLElement;
    const node = target.firstChild as Text;
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(node, 0);
      return range;
    };
    document.elementFromPoint = () => target;
    // jsdom has no layout. Every rect is 0×0 at the origin, which reads as "on
    // the page" — the off-column refusal is a device behaviour, not this one.
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    return pressedRunAt(1, 1);
  }

  /**
   * The run is what gets pinned, and the page splits words all the time:
   * bookmark highlighting wraps them in spans, furigana wraps kanji in ruby.
   * Reading only the pressed text node reports half a word.
   */
  it("reads a run that a bookmark span has split in two", () => {
    expect(
      pressOn('<p><span class="bookmarked-word">杏</span><span data-press>子</span>は</p>'),
    ).toEqual({ run: "杏子", currentReading: "" });
  });

  it("does not read across a paragraph boundary", () => {
    expect(pressOn("<p>帰国</p><p><span data-press>家</span>へ</p>")).toEqual({
      run: "家",
      currentReading: "",
    });
  });

  it("prefers the ruby's own base when the press lands in one", () => {
    expect(pressOn("<p><ruby data-press>杏子<rt>きょうこ</rt></ruby>は</p>")).toEqual({
      run: "杏子",
      currentReading: "きょうこ",
    });
  });

  it("has nothing to say about a press on kana", () => {
    expect(pressOn("<p><span data-press>は</span>帰る</p>")).toBeNull();
  });
});

describe("the long press itself", () => {
  function setupPage(): ReturnType<typeof vi.fn> {
    document.body.innerHTML = `<div id="page"><p>杏子は帰った</p></div>`;
    state.pageEl = document.getElementById("page");
    state.contentEl = state.pageEl;
    state.dragMode = "idle";
    state.suppressClick = false;
    const post = vi.fn();
    (window as unknown as { ReactNativeWebView: { postMessage: unknown } }).ReactNativeWebView = {
      postMessage: post,
    };
    // jsdom has no layout, so the press has to be told what it landed on.
    const textNode = document.querySelector("p")!.firstChild as Text;
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(textNode, 0);
      return range;
    };
    document.elementFromPoint = () => document.querySelector("p");
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    setupTouchHandlers();
    return post;
  }

  function touchWith(type: string, points: { x: number; y: number }[]): void {
    const event = new Event(type, { bubbles: true }) as TouchEvent & {
      touches: unknown;
      changedTouches: unknown;
    };
    const list = points.map((point) => ({ clientX: point.x, clientY: point.y }));
    Object.defineProperty(event, "touches", { value: list });
    Object.defineProperty(event, "changedTouches", { value: list });
    state.contentEl!.dispatchEvent(event);
  }

  function touch(type: string, x: number, y: number): void {
    touchWith(type, [{ x, y }]);
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks for the run after the finger has been still long enough", () => {
    const post = setupPage();
    touch("touchstart", 10, 10);
    expect(post).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);

    expect(JSON.parse(post.mock.calls.at(-1)![0] as string)).toMatchObject({
      type: "furiganaPin",
      run: "杏子",
    });
    // The click the release ends with must not also open the tap lookup.
    expect(state.suppressClick).toBe(true);
  });

  it("does not fire on a tap", () => {
    const post = setupPage();
    touch("touchstart", 10, 10);
    touch("touchend", 10, 10);
    vi.advanceTimersByTime(1000);
    expect(post).not.toHaveBeenCalled();
  });

  /**
   * 15px is under the threshold that decides swipe-or-select, so this is the
   * slack guard alone: a finger on its way somewhere is not a press.
   */
  it("does not fire once the finger has moved, even slightly", () => {
    const post = setupPage();
    touch("touchstart", 10, 10);
    touch("touchmove", 25, 10);
    vi.advanceTimersByTime(1000);
    expect(post).not.toHaveBeenCalled();
  });

  it("survives the jitter of a finger that is trying to be still", () => {
    const post = setupPage();
    touch("touchstart", 10, 10);
    touch("touchmove", 14, 12);
    vi.advanceTimersByTime(500);
    expect(post).toHaveBeenCalled();
  });

  /**
   * The sheet the press opens is a native modal, and presenting it while the
   * finger is still down cancels the WebView's touch — so touchend never
   * arrives. With the guard left set, every later tap in the book is swallowed.
   */
  it("lets go of the click guard when the touch is cancelled instead of ended", () => {
    setupPage();
    touch("touchstart", 10, 10);
    vi.advanceTimersByTime(500);
    expect(state.suppressClick).toBe(true);

    touch("touchcancel", 10, 10);
    vi.advanceTimersByTime(100);
    expect(state.suppressClick).toBe(false);
  });

  it("does not fire with a second finger down", () => {
    const post = setupPage();
    touchWith("touchstart", [
      { x: 10, y: 10 },
      { x: 200, y: 200 },
    ]);
    vi.advanceTimersByTime(1000);
    expect(post).not.toHaveBeenCalled();
  });

  /**
   * The hit test is done when the finger lands, so a page animation cannot move
   * different text under the original coordinates. What the walk must not do is
   * read a node the page has since replaced — a reload while the finger is
   * down leaves that node detached, still carrying its old text.
   */
  it("says nothing when the page is replaced under the finger", () => {
    const post = setupPage();
    touch("touchstart", 10, 10);
    document.getElementById("page")!.innerHTML = "<p>全く別の文</p>";
    vi.advanceTimersByTime(500);
    expect(post).not.toHaveBeenCalled();
  });

  /** Swallowing every later tap is how a gesture like this breaks a reader. */
  it("lets go of the click guard when the finger lifts", () => {
    setupPage();
    touch("touchstart", 10, 10);
    vi.advanceTimersByTime(500);
    expect(state.suppressClick).toBe(true);
    touch("touchend", 10, 10);
    vi.advanceTimersByTime(100);
    expect(state.suppressClick).toBe(false);
  });
});
