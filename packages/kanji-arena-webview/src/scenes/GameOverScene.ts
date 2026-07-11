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
    this.add
      .text(width / 2, height / 2 - 48, "The Night takes you", {
        fontFamily: "Georgia, serif",
        fontSize: "36px",
        color: "#f4e7c0",
      })
      .setOrigin(0.5);
    this.add
      .text(
        width / 2,
        height / 2 + 6,
        `reached floor ${this.summary.depth + 1} · ${this.summary.bound} spirits read`,
        { fontFamily: "monospace", fontSize: "16px", color: "#c9c6e0" },
      )
      .setOrigin(0.5);
    // The learning payload: how sharp your recall was, and the kotodama it minted.
    const acc = run.reads > 0 ? Math.round((run.hits / run.reads) * 100) : 0;
    this.add
      .text(
        width / 2,
        height / 2 + 30,
        `${run.hits}/${run.reads} recalled · ${acc}% accuracy · ◈ ${run.kotodama}`,
        { fontFamily: "monospace", fontSize: "13px", color: "#7ad1c4" },
      )
      .setOrigin(0.5);
    const gathered = [...run.relics].map((id) => RELIC_MAP[id].jp).join("  ");
    if (gathered) {
      this.add
        .text(width / 2, height / 2 + 60, gathered, {
          fontFamily: GLYPH_FONT,
          fontSize: "22px",
          color: "#f2c14e",
        })
        .setOrigin(0.5);
    }
    this.add
      .text(width / 2, height / 2 + (gathered ? 100 : 62), "press SPACE to descend anew", {
        fontFamily: "monospace",
        fontSize: "15px",
        color: "#8f88a6",
      })
      .setOrigin(0.5);

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
