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
    // The dimmed frozen dungeon shows through this immediately; the recap fades in.
    this.add.rectangle(0, 0, width, height, 0x08060f, 0.72).setOrigin(0, 0);

    // The glyphs you failed to read this run, worst first — the death recap
    // reveals their keywords so a lethal floor doubles as a study sheet.
    const missed = [...run.readLog.entries()]
      .filter(([, e]) => e.misses > 0)
      .sort((a, b) => b[1].misses - a[1].misses);
    const MAX_ROWS = 8;
    const shown = missed.slice(0, MAX_ROWS);
    const extra = missed.length - shown.length;

    const layer = this.add.container(0, 0);
    // A soft ember glow near the top (tinted reuse of the spirit aura).
    layer.add(
      this.add
        .image(width / 2, height * 0.24, "aura")
        .setTint(0xff5a4a)
        .setAlpha(0.16)
        .setScale(11),
    );

    const cx = width / 2;
    let y = height * 0.14;
    const T = (
      text: string,
      font: string,
      size: number,
      color: string,
      opts?: Phaser.Types.GameObjects.Text.TextStyle,
    ) => {
      const t = this.add
        .text(cx, y, text, { fontFamily: font, fontSize: `${size}px`, color, ...opts })
        .setOrigin(0.5);
      layer.add(t);
      return t;
    };

    T("The dark takes you.", "Georgia, serif", 40, "#ff8a7a");
    y += 52;
    T(
      `reached floor ${this.summary.depth + 1} · ${this.summary.bound} spirits read`,
      "monospace",
      15,
      "#c9c6e0",
    );
    y += 26;
    const acc = run.reads > 0 ? Math.round((run.hits / run.reads) * 100) : 0;
    T(
      `${run.hits}/${run.reads} recalled · ${acc}% accuracy · ◈ ${run.kotodama}`,
      "monospace",
      13,
      "#7ad1c4",
    );
    y += 42;

    if (shown.length) {
      T("THE GLYPHS THAT ELUDED YOU", "monospace", 12, "#8f88a6", { letterSpacing: 3 });
      y += 34;
      const cols = Math.min(4, shown.length);
      for (let i = 0; i < shown.length; i += cols) {
        const cells = shown.slice(i, i + cols).map(([kanji, e]) => {
          const g = this.add
            .text(0, 0, kanji, { fontFamily: GLYPH_FONT, fontSize: "26px", color: "#ff6b5c" })
            .setOrigin(0, 0.5);
          const kw = this.add
            .text(0, 0, ` = ${e.keyword}`, {
              fontFamily: "Georgia, serif",
              fontSize: "15px",
              color: "#e8dfc8",
            })
            .setOrigin(0, 0.5);
          return { g, kw, w: g.width + kw.width };
        });
        const gapX = 30;
        const totalW = cells.reduce((s, c) => s + c.w, 0) + gapX * (cells.length - 1);
        let x = cx - totalW / 2;
        for (const c of cells) {
          c.g.setPosition(x, y);
          c.kw.setPosition(x + c.g.width, y);
          layer.add([c.g, c.kw]);
          x += c.w + gapX;
        }
        y += 40;
      }
      if (extra > 0) {
        T(`+${extra} more`, "monospace", 12, "#8f88a6");
        y += 26;
      }
    }

    const gathered = [...run.relics].map((id) => RELIC_MAP[id].jp).join("  ");
    if (gathered) {
      T(gathered, GLYPH_FONT, 22, "#f2c14e");
      y += 34;
    }
    T(`press SPACE to descend anew — seed ${run.seed}`, "monospace", 14, "#7ad1c4");

    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 600, ease: "Sine.easeOut" });

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
