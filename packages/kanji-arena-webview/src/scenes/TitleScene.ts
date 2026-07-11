import Phaser from "phaser";
import { BG, settings } from "../config";
import { CORPUS } from "../rtk/corpus";

const GLYPH_FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Songti SC",serif';

// The opening frame: names the conceit (言霊 kotodama, "word-spirit") and the
// one loop that drives everything — read the kanji, speak its nature, bind it.
export default class TitleScene extends Phaser.Scene {
  constructor() {
    super("title");
  }

  create() {
    this.cameras.main.setBackgroundColor(BG);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    this.add
      .text(cx, cy - 150, "言霊", {
        fontFamily: GLYPH_FONT,
        fontSize: "92px",
        color: "#f4ecd6",
      })
      .setOrigin(0.5)
      .setAlpha(0.9);
    this.add
      .text(cx, cy - 58, "KOTODAMA", {
        fontFamily: "Georgia, serif",
        fontSize: "40px",
        color: "#f2c14e",
      })
      .setOrigin(0.5);
    this.add
      .text(cx, cy - 12, "a roguelite of word-spirits", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#9a94b0",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy + 40, "Read the kanji.  Speak its nature.  Bind the spirit.", {
        fontFamily: "Georgia, serif",
        fontSize: "18px",
        color: "#cfc8e0",
      })
      .setOrigin(0.5);
    this.add
      .text(
        cx,
        cy + 78,
        "WASD move   ·   hold SPACE / right-click, aim the wheel, release to read",
        { fontFamily: "monospace", fontSize: "13px", color: "#8f88a6" },
      )
      .setOrigin(0.5);

    // Difficulty: easy dims some wrong verbs on the wheel; hard dims none.
    // Toggle with H here or in the dungeon.
    const diffLine = this.add
      .text(cx, cy + 104, "", { fontFamily: "monospace", fontSize: "13px", color: "#7ad6a0" })
      .setOrigin(0.5);
    const paintDiff = () => {
      const easy = settings.difficulty === "easy";
      diffLine
        .setText(`mode: ${easy ? "easy" : "hard"}  ·  press H to toggle`)
        .setColor(easy ? "#7ad6a0" : "#e0a35a");
    };
    paintDiff();
    this.input.keyboard!.on("keydown-H", () => {
      settings.difficulty = settings.difficulty === "easy" ? "hard" : "easy";
      paintDiff();
    });

    const start = () => {
      this.scene.start("dungeon");
      this.scene.launch("hud");
      this.scene.bringToTop("hud");
    };

    const prompt = this.add
      .text(cx, cy + 140, "", { fontFamily: "monospace", fontSize: "16px", color: "#f4e7c0" })
      .setOrigin(0.5);

    // Gate descent on the host session — the dungeon builds spirits from the
    // corpus, so it must be loaded first (or CORPUS[0] would be undefined).
    const enable = () => {
      prompt.setText("press SPACE to descend");
      this.tweens.add({ targets: prompt, alpha: 0.25, duration: 850, yoyo: true, repeat: -1 });
      this.input.keyboard!.once("keydown-SPACE", start);
      this.input.once("pointerdown", start);
    };

    // Only allow descent with a non-empty corpus — the dungeon builds spirits
    // from it, so an empty/all-unmapped session must not reach the dungeon.
    const onReady = () => {
      if (CORPUS.length > 0) enable();
      else prompt.setText("no readable kanji to drill");
    };
    if (CORPUS.length > 0) {
      enable();
    } else {
      prompt.setText("loading your kanji…");
      this.game.events.once("corpusReady", onReady);
    }
  }
}
