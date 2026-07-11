import Phaser from "phaser";
import { sfx } from "../audio/sfx";
import { run } from "../core/run";
import { RELIC_MAP, RelicId } from "../rtk/relics";

const GLYPH_FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Songti SC",serif';

// The between-rooms reward: after an elite or boss, one of three kotodama relics
// is claimed. Pauses the dungeon; resumes it (and triggers descent) on pick.
export default class RelicScene extends Phaser.Scene {
  private choices: RelicId[] = [];
  private thenDescend = false;
  private picked = false;

  constructor() {
    super("relic");
  }

  init(data: { choices: RelicId[]; thenDescend: boolean }) {
    this.choices = data.choices ?? [];
    this.thenDescend = data.thenDescend ?? false;
    this.picked = false;
  }

  create() {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x08060f, 0.72).setOrigin(0, 0);
    this.add
      .text(width / 2, height / 2 - 170, "A kotodama offers itself", {
        fontFamily: "Georgia, serif",
        fontSize: "30px",
        color: "#f2c14e",
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 - 134, "claim one — press 1 / 2 / 3 or click", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#9a94b0",
      })
      .setOrigin(0.5);

    const CARD_W = 230;
    const GAP = 26;
    const n = this.choices.length;
    const totalW = n * CARD_W + (n - 1) * GAP;
    const startX = width / 2 - totalW / 2;

    this.choices.forEach((id, i) => {
      const relic = RELIC_MAP[id];
      const cx = startX + i * (CARD_W + GAP) + CARD_W / 2;
      const cy = height / 2 + 10;
      const card = this.add
        .rectangle(cx, cy, CARD_W, 250, 0x14111f, 0.98)
        .setStrokeStyle(1.5, 0xf2c14e, 0.5)
        .setInteractive({ useHandCursor: true });
      this.add
        .text(cx, cy - 96, relic.jp, { fontFamily: GLYPH_FONT, fontSize: "34px", color: "#f4ecd6" })
        .setOrigin(0.5);
      this.add
        .text(cx, cy - 52, relic.name, {
          fontFamily: "Georgia, serif",
          fontSize: "18px",
          color: "#f2c14e",
        })
        .setOrigin(0.5);
      this.add
        .text(cx, cy - 20, relic.flavor, {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#9a94b0",
          align: "center",
          wordWrap: { width: CARD_W - 28 },
          fontStyle: "italic",
        })
        .setOrigin(0.5, 0);
      this.add
        .text(cx, cy + 34, relic.effect, {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#cfc8e0",
          align: "center",
          wordWrap: { width: CARD_W - 28 },
        })
        .setOrigin(0.5, 0);
      this.add
        .text(cx - CARD_W / 2 + 10, cy - 116, String(i + 1), {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#f2c14e",
        })
        .setOrigin(0, 0.5);

      card.on("pointerover", () => card.setStrokeStyle(2.5, 0xffe27a, 0.95));
      card.on("pointerout", () => card.setStrokeStyle(1.5, 0xf2c14e, 0.5));
      card.on("pointerdown", () => this.pick(id));
      this.input.keyboard!.once(`keydown-${["ONE", "TWO", "THREE"][i]}`, () => this.pick(id));
    });
  }

  private pick(id: RelicId) {
    if (this.picked) return; // both keydown + pointerdown can fire before scene.stop()
    this.picked = true;
    sfx.relic();
    run.relics.add(id);
    this.game.events.emit("relicChosen", { id, thenDescend: this.thenDescend });
    this.game.events.emit("relicsChanged");
    this.scene.resume("dungeon");
    this.scene.stop();
  }
}
