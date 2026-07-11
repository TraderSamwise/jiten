import Phaser from "phaser";
import { sfx } from "../audio/sfx";
import { run } from "../core/run";
import { RELIC_MAP, RelicId } from "../rtk/relics";

const GLYPH_FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Songti SC",serif';

type ShopItem =
  | { kind: "relic"; cost: number; id: RelicId }
  | { kind: "heal"; cost: number }
  | { kind: "maxhp"; cost: number };

// A shop room: spend kotodama (earned per bind) on a relic, a full heal, or a
// permanent heart. Buy any you can afford, then leave. Pauses the dungeon;
// resumes on exit. Emits "relicChosen" (thenDescend:false) so relic side-effects
// reuse the dungeon's handler, and mutates run.hp/maxHp/kotodama directly.
export default class ShopScene extends Phaser.Scene {
  private items: ShopItem[] = [];
  private relicId: RelicId | null = null;
  private sold: boolean[] = [];
  private purse!: Phaser.GameObjects.Text;
  private cards: Phaser.GameObjects.Rectangle[] = [];
  private costLabels: Phaser.GameObjects.Text[] = [];
  private done = false;

  constructor() {
    super("shop");
  }

  init(data: { relic: RelicId | null }) {
    this.relicId = data.relic ?? null;
    this.done = false;
    this.cards = [];
    this.costLabels = [];
    this.items = [];
    if (this.relicId) this.items.push({ kind: "relic", cost: 6, id: this.relicId });
    this.items.push({ kind: "heal", cost: 3 });
    this.items.push({ kind: "maxhp", cost: 5 });
    this.sold = this.items.map(() => false);
  }

  create() {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x08060f, 0.72).setOrigin(0, 0);
    this.add
      .text(width / 2, height / 2 - 170, "The word-pedlar's stall", {
        fontFamily: "Georgia, serif",
        fontSize: "30px",
        color: "#7ad1c4",
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 - 134, "buy with 1 / 2 / 3 or click · SPACE / ESC to leave", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#9a94b0",
      })
      .setOrigin(0.5);
    this.purse = this.add
      .text(width / 2, height / 2 - 110, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#f2c14e",
      })
      .setOrigin(0.5);
    this.refreshPurse();

    const CARD_W = 230;
    const GAP = 26;
    const n = this.items.length;
    const totalW = n * CARD_W + (n - 1) * GAP;
    const startX = width / 2 - totalW / 2;

    this.items.forEach((item, i) => {
      const cx = startX + i * (CARD_W + GAP) + CARD_W / 2;
      const cy = height / 2 + 10;
      const card = this.add
        .rectangle(cx, cy, CARD_W, 250, 0x111a1c, 0.98)
        .setStrokeStyle(1.5, 0x7ad1c4, 0.5)
        .setInteractive({ useHandCursor: true });
      this.cards.push(card);
      const { jp, name, flavor, effect } = this.describe(item);
      this.add
        .text(cx, cy - 96, jp, { fontFamily: GLYPH_FONT, fontSize: "34px", color: "#f4ecd6" })
        .setOrigin(0.5);
      this.add
        .text(cx, cy - 52, name, {
          fontFamily: "Georgia, serif",
          fontSize: "18px",
          color: "#7ad1c4",
        })
        .setOrigin(0.5);
      this.add
        .text(cx, cy - 20, flavor, {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#9a94b0",
          align: "center",
          wordWrap: { width: CARD_W - 28 },
          fontStyle: "italic",
        })
        .setOrigin(0.5, 0);
      this.add
        .text(cx, cy + 30, effect, {
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
          color: "#7ad1c4",
        })
        .setOrigin(0, 0.5);
      const cost = this.add
        .text(cx, cy + 104, `◈ ${item.cost}`, {
          fontFamily: "monospace",
          fontSize: "15px",
          color: "#f2c14e",
        })
        .setOrigin(0.5);
      this.costLabels.push(cost);

      card.on("pointerover", () => {
        if (!this.sold[i]) card.setStrokeStyle(2.5, 0xffe27a, 0.95);
      });
      card.on("pointerout", () => {
        if (!this.sold[i]) card.setStrokeStyle(1.5, 0x7ad1c4, 0.5);
      });
      card.on("pointerdown", () => this.buy(i));
      this.input.keyboard!.on(`keydown-${["ONE", "TWO", "THREE"][i]}`, () => this.buy(i));
    });

    this.input.keyboard!.on("keydown-SPACE", this.leave, this);
    this.input.keyboard!.on("keydown-ESC", this.leave, this);
  }

  private describe(item: ShopItem) {
    if (item.kind === "relic") {
      const r = RELIC_MAP[item.id];
      return { jp: r.jp, name: r.name, flavor: r.flavor, effect: r.effect };
    }
    if (item.kind === "heal") {
      return {
        jp: "癒",
        name: "Balm of Words",
        flavor: "a warm draught",
        effect: "restore all hearts",
      };
    }
    return {
      jp: "命",
      name: "Vessel Rite",
      flavor: "the cup grows",
      effect: "+1 max heart (and heal it)",
    };
  }

  private refreshPurse() {
    this.purse.setText(`your purse: ◈ ${run.kotodama} kotodama`);
  }

  private buy(i: number) {
    if (this.done || this.sold[i]) return;
    const item = this.items[i];
    if (run.kotodama < item.cost) {
      sfx.spiritSurge();
      this.cameras.main.flash(120, 90, 20, 20);
      return;
    }
    if (item.kind === "heal" && run.hp >= run.maxHp) {
      sfx.spiritSurge();
      return; // nothing to heal — don't waste the purchase
    }
    run.kotodama -= item.cost;
    if (item.kind === "relic") {
      run.relics.add(item.id);
      this.game.events.emit("relicChosen", { id: item.id, thenDescend: false });
      this.game.events.emit("relicsChanged");
    } else if (item.kind === "heal") {
      run.hp = run.maxHp;
      this.game.events.emit("hpChanged");
    } else {
      run.maxHp += 1;
      run.hp += 1;
      this.game.events.emit("hpChanged");
    }
    sfx.relic();
    this.game.events.emit("kotodamaChanged");
    this.sold[i] = true;
    this.cards[i].setStrokeStyle(1.5, 0x555068, 0.5).setFillStyle(0x0c0c12, 0.98);
    this.costLabels[i].setText("sold").setColor("#6f6a82");
    this.refreshPurse();
  }

  private leave() {
    if (this.done) return;
    this.done = true;
    this.game.events.emit("shopDone");
    this.scene.resume("dungeon");
    this.scene.stop();
  }
}
