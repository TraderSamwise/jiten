import Phaser from "phaser";
import { run } from "../core/run";
import { RELIC_MAP } from "../rtk/relics";

const GLYPH_FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';

// Overlay shown on death; any key/tap starts a fresh descent from floor 1.
export default class GameOverScene extends Phaser.Scene {
  private summary = { depth: 0, bound: 0 };

  constructor() {
    super("gameover");
  }

  init(data?: { depth?: number; bound?: number }) {
    this.summary = { depth: data?.depth ?? 0, bound: data?.bound ?? 0 };
  }

  create() {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x08060f, 0.66).setOrigin(0, 0);

    // The glyphs you failed to read this run, worst first — the death recap
    // reveals their keywords so a lethal floor doubles as a study sheet.
    const missed = [...run.readLog.entries()]
      .filter(([, e]) => e.misses > 0)
      .sort((a, b) => b[1].misses - a[1].misses);
    const MAX_ROWS = 7;
    const shown = missed.slice(0, MAX_ROWS);
    const extra = missed.length - shown.length;

    // Stack every element top-to-bottom with a running cursor, then centre the
    // whole block vertically so the reveal list never collides with the prompt.
    const rows: { text: string; font: string; size: number; color: string; gap: number }[] = [];
    rows.push({
      text: "The Night takes you",
      font: "Georgia, serif",
      size: 36,
      color: "#f4e7c0",
      gap: 40,
    });
    rows.push({
      text: `reached floor ${this.summary.depth + 1} · ${this.summary.bound} spirits read`,
      font: "monospace",
      size: 16,
      color: "#c9c6e0",
      gap: 26,
    });
    const acc = run.reads > 0 ? Math.round((run.hits / run.reads) * 100) : 0;
    rows.push({
      text: `${run.hits}/${run.reads} recalled · ${acc}% accuracy · ◈ ${run.kotodama}`,
      font: "monospace",
      size: 13,
      color: "#7ad1c4",
      gap: shown.length ? 30 : 20,
    });
    if (shown.length) {
      rows.push({
        text: "the glyphs that eluded you",
        font: "Georgia, serif",
        size: 15,
        color: "#d8b06a",
        gap: 26,
      });
      for (const [kanji, e] of shown) {
        rows.push({
          text: `${kanji} = ${e.keyword}`,
          font: GLYPH_FONT,
          size: 20,
          color: "#ff6b5c",
          gap: 24,
        });
      }
      if (extra > 0) {
        rows.push({
          text: `+${extra} more`,
          font: "monospace",
          size: 12,
          color: "#8f88a6",
          gap: 20,
        });
      }
    }
    const gathered = [...run.relics].map((id) => RELIC_MAP[id].jp).join("  ");
    if (gathered) {
      rows.push({ text: gathered, font: GLYPH_FONT, size: 22, color: "#f2c14e", gap: 34 });
    }
    rows.push({
      text: "press SPACE to descend anew",
      font: "monospace",
      size: 15,
      color: "#8f88a6",
      gap: 0,
    });

    const totalH = rows.reduce((h, r) => h + r.gap, 0);
    let y = height / 2 - totalH / 2;
    for (const r of rows) {
      this.add
        .text(width / 2, y, r.text, { fontFamily: r.font, fontSize: `${r.size}px`, color: r.color })
        .setOrigin(0.5);
      y += r.gap;
    }

    const retry = () => {
      this.scene.stop();
      // Pass explicit fresh data so Phaser overwrites the stale descent payload
      // (a bare restart() reuses it) and the depth-0 fresh-run reset fires.
      this.scene.get("dungeon").scene.restart({ depth: 0 });
    };
    this.input.keyboard!.once("keydown-SPACE", retry);
    this.input.once("pointerdown", retry);
    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.onResize, this));
  }

  private onResize() {
    this.scene.restart(this.summary);
  }
}
