import { describe, expect, it } from "vitest";

import { answerPieces, buildBoard, judge, pieceOf, type AssemblePiece } from "./rtk-assemble";
import type { KanjiPrimitive } from "@/db/types";

function real(position: number, glyph: string, keyword = `kw-${glyph}`): KanjiPrimitive {
  return { position, glyph, primitiveId: null, keyword, isPrimitive: false, displayGlyph: null };
}

function invented(position: number, id: number, keyword = `kw-p${id}`): KanjiPrimitive {
  return {
    position,
    glyph: null,
    primitiveId: id,
    keyword,
    isPrimitive: true,
    displayGlyph: "屆",
  };
}

function pool(n: number): AssemblePiece[] {
  return Array.from({ length: n }, (_, i) => ({
    target: `pool${i}`,
    glyph: null,
    displayGlyph: null,
    keyword: `pool-kw-${i}`,
  }));
}

describe("identifying a component", () => {
  it("uses the glyph for a real kanji and p<id> for an invented primitive", () => {
    expect(pieceOf(real(1, "亘"))?.target).toBe("亘");
    expect(pieceOf(invented(1, 42))?.target).toBe("p42");
  });

  it("has no identity for a component that is neither", () => {
    expect(
      pieceOf({
        position: 1,
        glyph: null,
        primitiveId: null,
        keyword: "x",
        isPrimitive: true,
        displayGlyph: null,
      }),
    ).toBeNull();
  });
});

describe("the answer", () => {
  it("is the components in writing order", () => {
    const pieces = answerPieces([real(3, "三"), real(1, "一"), real(2, "二")]);
    expect(pieces.map((p) => p.target)).toEqual(["一", "二", "三"]);
  });

  it("asks a repeated component once", () => {
    // 林 is tree + tree; two identical tiles could not be told apart.
    const pieces = answerPieces([real(1, "木"), real(2, "木")]);
    expect(pieces.map((p) => p.target)).toEqual(["木"]);
  });

  it("drops a component with no identity", () => {
    const orphan: KanjiPrimitive = {
      position: 2,
      glyph: null,
      primitiveId: null,
      keyword: "ghost",
      isPrimitive: true,
      displayGlyph: null,
    };
    expect(answerPieces([real(1, "木"), orphan]).map((p) => p.target)).toEqual(["木"]);
  });
});

describe("the board", () => {
  const primitives = [real(1, "宀"), real(2, "亘")];

  it("shows the answer plus the decoys asked for", () => {
    const board = buildBoard(primitives, pool(10), 3, 1);
    expect(board.answer).toHaveLength(2);
    expect(board.tiles).toHaveLength(5);
  });

  it("never offers a decoy that is part of the answer", () => {
    const overlapping: AssemblePiece[] = [
      { target: "宀", glyph: "宀", displayGlyph: null, keyword: "house" },
      ...pool(5),
    ];
    const board = buildBoard(primitives, overlapping, 3, 2);
    const targets = board.tiles.map((t) => t.target);
    expect(targets.filter((t) => t === "宀")).toHaveLength(1);
  });

  it("never offers a decoy twice", () => {
    const board = buildBoard(primitives, [...pool(3), ...pool(3)], 3, 3);
    const targets = board.tiles.map((t) => t.target);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("skips a pool entry with no keyword to show", () => {
    const nameless: AssemblePiece[] = [
      { target: "x", glyph: null, displayGlyph: null, keyword: null },
    ];
    const board = buildBoard(primitives, nameless, 3, 4);
    expect(board.tiles).toHaveLength(2);
  });

  it("does not show the pieces in answer order", () => {
    const orders = new Set(
      Array.from({ length: 12 }, (_, seed) =>
        buildBoard(primitives, pool(6), 3, seed)
          .tiles.map((t) => t.target)
          .join(","),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it("lays the same board out for the same seed", () => {
    const a = buildBoard(primitives, pool(6), 3, 9).tiles.map((t) => t.target);
    const b = buildBoard(primitives, pool(6), 3, 9).tiles.map((t) => t.target);
    expect(a).toEqual(b);
  });
});

describe("judging the taps", () => {
  const answer = answerPieces([real(1, "宀"), real(2, "亘")]);

  it("is still building while the order holds", () => {
    expect(judge([], answer)).toBe("building");
    expect(judge(["宀"], answer)).toBe("building");
  });

  it("is done on the last right tap", () => {
    expect(judge(["宀", "亘"], answer)).toBe("done");
  });

  it("is wrong the moment the order breaks", () => {
    expect(judge(["亘"], answer)).toBe("wrong");
    expect(judge(["宀", "木"], answer)).toBe("wrong");
  });

  it("is wrong past the end rather than done", () => {
    expect(judge(["宀", "亘", "木"], answer)).toBe("wrong");
  });
});
