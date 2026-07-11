import Phaser from "phaser";
import type { ArenaPrimitive } from "../protocol";

const GLYPH_FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Songti SC",serif';
// The bundled RTK font that redraws invented-primitive substitute chars as shapes.
const RTK_FONT = "RtkPrimitives";

interface StudyData {
  kanji: string;
  keyword: string;
  primitives: ArenaPrimitive[];
  story: string;
}

interface Btn {
  setLabel(s: string): void;
  setEnabled(on: boolean): void;
  setOnClick(fn: () => void): void;
  trigger(): void;
}

// The recall gate's supplemental parts line — names only (shapes are drawn as a
// chip row in the teach panel, where first learning actually happens).
function primNames(primitives: ArenaPrimitive[]): string {
  const names = primitives.map((p) => p.keyword).filter(Boolean);
  return names.length ? `woven from  ${names.join("  +  ")}` : "";
}

// The Rite of Naming — a new kanji-spirit's first learning. With a saved
// mnemonic, gate on recall (story hidden → reveal → self-check) before binding
// it in the wild; without one, show its parts and offer an AI-drafted story. A
// study alcove is non-combat, so this safely pauses the dungeon and resumes on
// close.
export default class StudyScene extends Phaser.Scene {
  private card!: StudyData;
  private done = false;
  private storyHandler?: (r: { token: string; kanji: string; text: string }) => void;

  constructor() {
    super("study");
  }

  init(data: StudyData) {
    this.card = data;
    this.done = false;
    this.storyHandler = undefined;
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const wrap = Math.min(560, width - 80);
    this.add.rectangle(0, 0, width, height, 0x08060f, 0.78).setOrigin(0, 0);
    this.add
      .text(cx, height / 2 - 188, "言の名づけ", {
        fontFamily: GLYPH_FONT,
        fontSize: "24px",
        color: "#c9b8f0",
      })
      .setOrigin(0.5);
    this.add
      .text(cx, height / 2 - 158, "RITE OF NAMING", {
        fontFamily: "Georgia, serif",
        fontSize: "15px",
        color: "#b08cf0",
      })
      .setOrigin(0.5);
    this.add
      .text(cx, height / 2 - 96, this.card.kanji, {
        fontFamily: GLYPH_FONT,
        fontSize: "74px",
        color: "#f4ecd6",
      })
      .setOrigin(0.5);
    this.add
      .text(cx, height / 2 - 28, this.card.keyword, {
        fontFamily: "Georgia, serif",
        fontSize: "22px",
        color: "#f2c14e",
      })
      .setOrigin(0.5);

    if (this.card.story.trim()) this.buildRecallGate(cx, height, wrap);
    else this.buildTeach(cx, height, wrap);

    this.input.keyboard!.on("keydown-ESC", this.close, this);
  }

  // Story present: hide it, let the player recall, then reveal to self-check.
  private buildRecallGate(cx: number, height: number, wrap: number) {
    const prompt = this.add
      .text(cx, height / 2 + 18, "Recall its story — then check yourself.", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#9a94b0",
      })
      .setOrigin(0.5);
    const story = this.add
      .text(cx, height / 2 + 52, "", {
        fontFamily: "Georgia, serif",
        fontSize: "16px",
        color: "#cfc8e0",
        align: "center",
        wordWrap: { width: wrap },
      })
      .setOrigin(0.5, 0);
    let revealed = false;
    const btn = this.button(cx - 96, height / 2 + 156, "Show story", () => {
      if (revealed) return this.close();
      revealed = true;
      const line = primNames(this.card.primitives);
      story.setText(this.card.story + (line ? `\n\n${line}` : ""));
      prompt.setText("Does it still click?");
      btn.setLabel("Got it");
    });
    this.button(cx + 96, height / 2 + 156, "Modify", () => {
      this.game.events.emit("editStory", { kanji: this.card.kanji, current: this.card.story });
    });
    this.storyHandler = (r) => {
      if (r.kanji !== this.card.kanji) return;
      const text = r.text.trim();
      if (!text) return;
      this.card.story = text;
      revealed = true;
      const line = primNames(this.card.primitives);
      story.setText(text + (line ? `\n\n${line}` : ""));
      prompt.setText("Does it still click?");
      btn.setLabel("Got it");
    };
    this.game.events.on("storyDelivered", this.storyHandler);
    this.input.keyboard!.on("keydown-SPACE", (e: KeyboardEvent) => {
      if (!e.repeat) btn.trigger(); // ignore OS auto-repeat so a held key can't skip the gate
    });
  }

  // No story yet: show the parts (shape + name) and offer to draft one with AI.
  private buildTeach(cx: number, height: number, wrap: number) {
    const status = this.add
      .text(cx, height / 2 + 18, "No story yet — weave one from its parts.", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#9a94b0",
      })
      .setOrigin(0.5);
    const prims = this.card.primitives;
    const chips = prims.length ? this.renderPrimitives(cx, height / 2 + 42, prims) : [];
    const noParts = prims.length
      ? undefined
      : this.add
          .text(cx, height / 2 + 54, "no breakdown — build from the keyword", {
            fontFamily: "Georgia, serif",
            fontSize: "16px",
            color: "#7ad1c4",
            align: "center",
            wordWrap: { width: wrap },
          })
          .setOrigin(0.5);
    const story = this.add
      .text(cx, height / 2 + 38, "", {
        fontFamily: "Georgia, serif",
        fontSize: "16px",
        color: "#cfc8e0",
        align: "center",
        wordWrap: { width: wrap },
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    const showStory = (text: string) => {
      chips.forEach((o) => o.setVisible(false));
      noParts?.setVisible(false);
      story.setText(text).setVisible(true);
    };

    let pending: "ai" | "edit" | null = null;
    const gen = this.button(cx - 96, height / 2 + 150, "Generate with AI", () => {});
    const write = this.button(cx + 96, height / 2 + 150, "Write my own", () => {
      pending = "edit";
      this.game.events.emit("editStory", { kanji: this.card.kanji, current: this.card.story });
    });
    const skip = this.button(cx, height / 2 + 204, "Got it", () => this.close());
    gen.setOnClick(() => {
      pending = "ai";
      status.setText("conjuring a story…");
      gen.setEnabled(false);
      this.game.events.emit("requestStory", {
        kanji: this.card.kanji,
        keyword: this.card.keyword,
        primitives: this.card.primitives.map((p) => p.keyword),
      });
    });

    this.storyHandler = (r) => {
      if (r.kanji !== this.card.kanji) return;
      const text = r.text.trim();
      if (text) {
        this.card.story = text;
        showStory(text);
        status.setText("your story — keep it?");
        gen.setLabel("Keep");
        gen.setEnabled(true);
        gen.setOnClick(() => this.close());
        write.setLabel("Edit");
      } else {
        status.setText(
          pending === "edit" ? "no story yet — play on" : "couldn't reach the oracle — play on",
        );
        gen.setEnabled(true);
      }
      pending = null;
    };
    this.game.events.on("storyDelivered", this.storyHandler);

    this.input.keyboard!.on("keydown-SPACE", (e: KeyboardEvent) => {
      if (!e.repeat) skip.trigger();
    });
  }

  // Draw the primitives as a centered chip row: shape (a real glyph in the CJK
  // font, or the invented-primitive substitute in the bundled RTK font) over its
  // name. Returns every Text created so the caller can hide them for a story.
  private renderPrimitives(
    cx: number,
    y: number,
    prims: ArenaPrimitive[],
  ): Phaser.GameObjects.Text[] {
    const objs: Phaser.GameObjects.Text[] = [];
    const rtkShapes: Phaser.GameObjects.Text[] = [];
    const groups = prims.map((p) => {
      const shape = this.add
        .text(0, y, p.glyph || p.display || "", {
          fontFamily: p.glyph ? GLYPH_FONT : RTK_FONT,
          fontSize: "34px",
          color: "#e8dfc8",
        })
        .setOrigin(0.5, 0);
      const name = this.add
        .text(0, y + 44, p.keyword, {
          fontFamily: "Georgia, serif",
          fontSize: "12px",
          color: "#7ad1c4",
          align: "center",
          wordWrap: { width: 104 },
        })
        .setOrigin(0.5, 0);
      objs.push(shape, name);
      if (p.display) rtkShapes.push(shape);
      return { shape, name };
    });
    // Center the row using live text widths, so it re-flows once the RTK font loads.
    const layout = () => {
      const gap = 16;
      const widths = groups.map((g) => Math.max(g.shape.width, g.name.width) + 10);
      const total = widths.reduce((s, w) => s + w, 0) + gap * (groups.length - 1);
      let x = cx - total / 2;
      groups.forEach((g, i) => {
        const gx = x + widths[i] / 2;
        g.shape.setX(gx);
        g.name.setX(gx);
        x += widths[i] + gap;
      });
    };
    layout();
    // Phaser rasterizes canvas text once; if the RTK font wasn't ready yet, redraw
    // those shapes when it loads and re-center now that their widths are real.
    if (rtkShapes.length && typeof document !== "undefined" && document.fonts?.load) {
      document.fonts
        .load('34px "RtkPrimitives"')
        .then(() => {
          rtkShapes.forEach((s) => s.updateText());
          layout();
        })
        .catch(() => {});
    }
    return objs;
  }

  private button(x: number, y: number, label: string, onClick: () => void): Btn {
    let handler = onClick;
    let enabled = true;
    const rect = this.add
      .rectangle(x, y, 180, 44, 0x111a1c, 0.98)
      .setStrokeStyle(1.5, 0xb08cf0, 0.6)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x, y, label, { fontFamily: "monospace", fontSize: "15px", color: "#f4ecd6" })
      .setOrigin(0.5);
    rect.on("pointerover", () => {
      if (enabled) rect.setStrokeStyle(2.5, 0xd9c4ff, 0.95);
    });
    rect.on("pointerout", () => {
      if (enabled) rect.setStrokeStyle(1.5, 0xb08cf0, 0.6);
    });
    rect.on("pointerdown", () => {
      if (enabled) handler();
    });
    return {
      setLabel: (s: string) => text.setText(s),
      setEnabled: (on: boolean) => {
        enabled = on;
        rect.setAlpha(on ? 1 : 0.5);
        text.setAlpha(on ? 1 : 0.6);
      },
      setOnClick: (fn: () => void) => {
        handler = fn;
      },
      trigger: () => {
        if (enabled) handler();
      },
    };
  }

  private close() {
    if (this.done) return;
    this.done = true;
    if (this.storyHandler) {
      this.game.events.off("storyDelivered", this.storyHandler);
      this.storyHandler = undefined;
    }
    this.game.events.emit("studyDone");
    this.scene.resume("dungeon");
    this.scene.stop();
  }
}
