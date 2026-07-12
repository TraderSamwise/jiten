import Phaser from "phaser";
import { sfx } from "../audio/sfx";
import { settings, WHEEL_DEADZONE, WHEEL_RADIUS_FRAC } from "../config";
import { run } from "../core/run";
import { JOY_RADIUS, touch } from "../core/touchControls";
import { key, RoomType } from "../dungeon/types";
import { STATE_COLOR } from "../rtk/srs";
import { RELIC_IDS, RELIC_MAP } from "../rtk/relics";
import { MAX_RING_CHOICES } from "../rtk/forge";
import { sigilKey } from "../rtk/sigils";
import { VERB_MAP, VerbId, WHEEL_ORDER } from "../rtk/verbs";
import { radialIndexAt, segmentAngles, slotMid, wheelVerbAt } from "../rtk/wheel";

interface FocusInfo {
  kanji: string; // shown in the hub while reading
}
interface ForgeWheelInfo {
  words: { verb: VerbId; word: string }[]; // the selectable spokes and their labels
}
interface ForgeRingInfo {
  stage: number; // 0-based index of the primitive being named
  total: number; // how many primitives in this read
  faceText: string; // the primitive's shape (glyph or RTK substitute char)
  faceRtk: boolean; // draw faceText in the bundled RTK font, not the CJK font
  choices: string[]; // candidate keywords laid out around the ring
  faces: { text: string; rtk: boolean }[]; // all primitive shapes, for the breadcrumb
  kanji: string; // the compound being forged (end of the breadcrumb)
}
interface ReadInfo {
  kanji: string;
  keyword: string;
  ok: boolean;
  story?: string;
  forged?: boolean; // the read named primitives first — cement the story on a hit
}
interface StudyInfo {
  kanji: string;
  keyword: string;
  primitives: string[];
  story: string;
}
interface OrdealInfo {
  keyword: string;
  remaining: number;
  total: number;
  timed: boolean;
  boss: boolean;
  seconds: number;
}

const CELL = 14;
const GAP = 3;
const PAD = 14;
const CRUMB_SLOTS = 12; // breadcrumb pool cap (primitives + the compound)

const TYPE_COLOR: Record<RoomType, number> = {
  start: 0x4b5bd6,
  normal: 0x6b6f8c,
  boss: 0xc23a4b,
  treasure: 0xd8ad33,
  shrine: 0x5ab0e0,
  shop: 0x2fbfa8,
};

const GLYPH_FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Songti SC",serif';
const RTK_FONT = "RtkPrimitives";

// Minimap + hearts + the read-wheel overlay. Fixed to the screen (unzoomed), so
// it lives above the dungeon. The wheel is drawn in screen space; the highlighted
// verb is computed from the shared pointer, matching what DungeonScene resolves.
export default class HudScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private joyG!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private hearts!: Phaser.GameObjects.Text;
  private purse!: Phaser.GameObjects.Text;

  private veil!: Phaser.GameObjects.Rectangle;
  private wheelG!: Phaser.GameObjects.Graphics;
  private hub!: Phaser.GameObjects.Arc;
  private hubGlyph!: Phaser.GameObjects.Text;
  private sigils: Phaser.GameObjects.Image[] = [];
  // The verb wheel is a multiple-choice: only wheelWords spokes carry a keyword
  // (correct + wrong deck-word distractors) and are selectable; the rest are
  // greyed. wheelLabels is one reusable label per spoke position.
  private wheelWords = new Map<VerbId, string>();
  private wheelLabels: Phaser.GameObjects.Text[] = [];
  private focusing = false;
  // Forge: while naming primitives the overlay is a recognition ring (forgeMode
  // true) instead of the verb wheel. candTexts are the ring's keyword candidates.
  private forgeMode = false;
  private focusKanji = "";
  private ringChoices: string[] = [];
  private ringFace = "";
  private ringRtk = false;
  private ringStage = 0;
  private ringTotal = 0;
  private candTexts: Phaser.GameObjects.Text[] = [];
  private ringChipsG!: Phaser.GameObjects.Graphics; // pill backgrounds behind ring candidates
  private crumbG!: Phaser.GameObjects.Graphics; // breadcrumb box/dashes
  private crumbTexts: Phaser.GameObjects.Text[] = []; // 日 — 月 — 明 sequence
  private ringFaces: { text: string; rtk: boolean }[] = [];
  private ringKanji = "";
  private ringCrumbCount = 0;
  // Owned relics as rounded pill chips (glyph badge + name), one pooled chip per
  // possible relic, shown/laid out on relicsChanged.
  private relicChips: {
    c: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Graphics;
    jp: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
  }[] = [];
  private streakText!: Phaser.GameObjects.Text;
  private lastStreak = -1;
  private frameGfx!: Phaser.GameObjects.Graphics; // faint panel border round the viewport
  private muteInd!: Phaser.GameObjects.Text;
  private difficultyInd!: Phaser.GameObjects.Text;

  private hubHint!: Phaser.GameObjects.Text;
  private ringCue!: Phaser.GameObjects.Text; // "name this part" on a primitive ring
  private readToast!: Phaser.GameObjects.Text;
  private teachToast!: Phaser.GameObjects.Text;
  private ordealBanner!: Phaser.GameObjects.Text;
  private ordealBarBg!: Phaser.GameObjects.Rectangle;
  private ordealBar!: Phaser.GameObjects.Image;
  private study!: Phaser.GameObjects.Container;
  private studyBg!: Phaser.GameObjects.Rectangle;
  private studyK!: Phaser.GameObjects.Text;
  private studyKw!: Phaser.GameObjects.Text;
  private studyPrim!: Phaser.GameObjects.Text;
  private studyStory!: Phaser.GameObjects.Text;

  private codexDim!: Phaser.GameObjects.Rectangle;
  private codex!: Phaser.GameObjects.Container;
  private codexBg!: Phaser.GameObjects.Rectangle;
  private codexTitle!: Phaser.GameObjects.Text;
  private codexStats!: Phaser.GameObjects.Text;
  private codexBody!: Phaser.GameObjects.Text;
  private codexFoot!: Phaser.GameObjects.Text;
  private codexOpen = false;

  // On-screen controls for touch play: built only on touch devices. Menu is
  // always up; Cycle/Heal appear during a read. Their screen rects are published
  // to `touch.buttons` so DungeonScene's joystick/read handler ignores taps on them.
  private isTouch = false;
  private menuBtn?: Phaser.GameObjects.Container;
  private cycleBtn?: Phaser.GameObjects.Container;
  private healBtn?: Phaser.GameObjects.Container;
  private tapZones: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super("hud");
  }

  create() {
    this.isTouch = this.sys.game.device.input.touch;
    this.g = this.add.graphics();
    this.joyG = this.add.graphics().setDepth(9);
    this.label = this.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#c9c6e0",
    });
    this.hearts = this.add.text(PAD, PAD, "", {
      fontFamily: "monospace",
      fontSize: "22px",
      color: "#ff5a6a",
    });
    this.purse = this.add.text(PAD, PAD + 26, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#2fbfa8",
    });
    this.hint = this.add
      .text(
        0,
        0,
        this.isTouch
          ? "Sealed — read the spirits  (tap right to read · drag to aim · lift to name each part · ⇄ switches)"
          : "Sealed — read the spirits  (hold SPACE · click each part · release on the wheel · Q switches)",
        {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#f4e7c0",
          backgroundColor: "#00000088",
          padding: { x: 10, y: 6 },
        },
      )
      .setOrigin(0.5, 1)
      .setVisible(false);

    this.muteInd = this.add
      .text(PAD, 0, "", { fontFamily: "monospace", fontSize: "12px", color: "#8f88a6" })
      .setOrigin(0, 1);
    this.onMute(sfx.isMuted());

    this.difficultyInd = this.add
      .text(PAD, 0, "", { fontFamily: "monospace", fontSize: "12px", color: "#8f88a6" })
      .setOrigin(0, 1);
    this.onDifficulty(settings.difficulty);

    this.streakText = this.add.text(PAD, PAD + 44, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#e0a35a",
    });
    this.frameGfx = this.add.graphics().setDepth(1);
    this.buildRelicChips();

    this.buildWheel();
    this.buildOverlays();
    this.buildCodex();
    if (this.isTouch) this.buildTouchControls();

    this.game.events.on("roomChanged", this.draw, this);
    this.game.events.on("roomChanged", this.hideStudy, this);
    this.game.events.on("difficultyChanged", this.onDifficulty, this);
    this.game.events.on("muteChanged", this.onMute, this);
    this.game.events.on("lockState", this.onLock, this);
    this.game.events.on("hpChanged", this.drawHearts, this);
    this.game.events.on("kotodamaChanged", this.drawPurse, this);
    this.game.events.on("roomChanged", this.drawPurse, this);
    this.game.events.on("focusStart", this.onFocusStart, this);
    this.game.events.on("forgeRing", this.onForgeRing, this);
    this.game.events.on("forgeWheel", this.onForgeWheel, this);
    this.game.events.on("focusEnd", this.onFocusEnd, this);
    this.game.events.on("read", this.onRead, this);
    this.game.events.on("studyShow", this.onStudyShow, this);
    this.game.events.on("ordealNeed", this.onOrdealNeed, this);
    this.game.events.on("ordealEnd", this.onOrdealEnd, this);
    this.game.events.on("floorClear", this.onFloorClear, this);
    this.game.events.on("shrineBless", this.onShrineBless, this);
    this.game.events.on("shielded", this.onShielded, this);
    this.game.events.on("gauntletStart", this.onGauntletStart, this);
    this.game.events.on("gauntletClear", this.onGauntletClear, this);
    this.game.events.on("bossPhasing", this.onBossPhasing, this);
    this.game.events.on("meetKind", this.onMeetKind, this);
    this.game.events.on("magpieSteal", this.onMagpieSteal, this);
    this.game.events.on("magpieCaught", this.onMagpieCaught, this);
    this.game.events.on("relicsChanged", this.drawRelics, this);
    this.game.events.on("pauseMenu", this.toggleCodex, this);
    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => {
      this.game.events.off("roomChanged", this.draw, this);
      this.game.events.off("roomChanged", this.hideStudy, this);
      this.game.events.off("difficultyChanged", this.onDifficulty, this);
      this.game.events.off("muteChanged", this.onMute, this);
      this.game.events.off("lockState", this.onLock, this);
      this.game.events.off("hpChanged", this.drawHearts, this);
      this.game.events.off("kotodamaChanged", this.drawPurse, this);
      this.game.events.off("roomChanged", this.drawPurse, this);
      this.game.events.off("focusStart", this.onFocusStart, this);
      this.game.events.off("forgeRing", this.onForgeRing, this);
      this.game.events.off("forgeWheel", this.onForgeWheel, this);
      this.game.events.off("focusEnd", this.onFocusEnd, this);
      this.game.events.off("read", this.onRead, this);
      this.game.events.off("studyShow", this.onStudyShow, this);
      this.game.events.off("ordealNeed", this.onOrdealNeed, this);
      this.game.events.off("ordealEnd", this.onOrdealEnd, this);
      this.game.events.off("floorClear", this.onFloorClear, this);
      this.game.events.off("shrineBless", this.onShrineBless, this);
      this.game.events.off("shielded", this.onShielded, this);
      this.game.events.off("gauntletStart", this.onGauntletStart, this);
      this.game.events.off("gauntletClear", this.onGauntletClear, this);
      this.game.events.off("bossPhasing", this.onBossPhasing, this);
      this.game.events.off("meetKind", this.onMeetKind, this);
      this.game.events.off("magpieSteal", this.onMagpieSteal, this);
      this.game.events.off("magpieCaught", this.onMagpieCaught, this);
      this.game.events.off("relicsChanged", this.drawRelics, this);
      this.game.events.off("pauseMenu", this.toggleCodex, this);
      this.scale.off("resize", this.layout, this);
    });

    this.layout();
    this.draw();
    this.drawHearts();
    this.drawPurse();
    this.drawRelics();
  }

  private buildWheel() {
    this.veil = this.add
      .rectangle(0, 0, 10, 10, 0x0b0912, 0.6)
      .setOrigin(0, 0)
      .setVisible(false)
      .setDepth(10);
    this.wheelG = this.add.graphics().setDepth(11).setVisible(false);
    this.hub = this.add
      .circle(0, 0, 10, 0x0b0912, 0.92)
      .setStrokeStyle(1.5, 0xffffff, 0.18)
      .setDepth(12)
      .setVisible(false);
    this.hubGlyph = this.add
      .text(0, 0, "", { fontFamily: GLYPH_FONT, fontSize: "40px", color: "#f4ecd6" })
      .setOrigin(0.5)
      .setDepth(13)
      .setVisible(false);
    for (const id of WHEEL_ORDER) {
      const img = this.add.image(0, 0, sigilKey(id)).setOrigin(0.5).setDepth(13).setVisible(false);
      this.sigils.push(img);
    }
    // One reusable keyword label per wheel spoke (worded spokes fill them).
    for (let i = 0; i < WHEEL_ORDER.length; i++) {
      const t = this.add
        .text(0, 0, "", { fontFamily: "Georgia, serif", fontSize: "15px", color: "#f7ecc9" })
        .setOrigin(0.5)
        .setDepth(14)
        .setVisible(false);
      this.wheelLabels.push(t);
    }
    // Reusable keyword candidates for the Forge's primitive rings — sized to the
    // max so the pool can never be indexed past however the count is tuned.
    for (let i = 0; i < MAX_RING_CHOICES; i++) {
      const t = this.add
        .text(0, 0, "", { fontFamily: "Georgia, serif", fontSize: "15px", color: "#cfc8e0" })
        .setOrigin(0.5)
        .setDepth(14)
        .setVisible(false);
      this.candTexts.push(t);
    }
    this.ringChipsG = this.add.graphics().setDepth(13);
    this.crumbG = this.add.graphics().setDepth(13);
    for (let i = 0; i < CRUMB_SLOTS; i++) {
      const t = this.add
        .text(0, 0, "", { fontFamily: GLYPH_FONT, fontSize: "22px", color: "#6a6480" })
        .setOrigin(0.5)
        .setDepth(14)
        .setVisible(false);
      this.crumbTexts.push(t);
    }
  }

  private buildOverlays() {
    this.hubHint = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#f2c14e",
        align: "center",
        letterSpacing: 2,
      })
      .setOrigin(0.5, 0)
      .setDepth(13)
      .setVisible(false);
    // Tells a first-timer the ring is a question, not a menu: pick the keyword
    // that names the shape in the hub. Shown only during primitive rings.
    this.ringCue = this.add
      .text(0, 0, "NAME THIS PART", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#7ad1c4",
        letterSpacing: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(13)
      .setVisible(false);
    this.readToast = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#f4ecd6",
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);
    // On a missed read, the Heisig story surfaces here — the failed recall is
    // the moment the mnemonic teaches best.
    this.teachToast = this.add
      .text(0, 0, "", {
        fontFamily: "Georgia, serif",
        fontSize: "15px",
        color: "#f4ecd6",
        align: "center",
        backgroundColor: "#1a1526e6",
        padding: { x: 14, y: 10 },
        wordWrap: { width: 440 },
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);

    this.studyBg = this.add
      .rectangle(0, 0, 360, 210, 0x14111f, 0.96)
      .setStrokeStyle(1, 0xffffff, 0.14);
    this.studyK = this.add
      .text(0, -70, "", { fontFamily: GLYPH_FONT, fontSize: "56px", color: "#f4ecd6" })
      .setOrigin(0.5);
    this.studyKw = this.add
      .text(0, -18, "", { fontFamily: "monospace", fontSize: "18px", color: "#f2c14e" })
      .setOrigin(0.5);
    this.studyPrim = this.add
      .text(0, 14, "", { fontFamily: "monospace", fontSize: "13px", color: "#9a94b0" })
      .setOrigin(0.5);
    this.studyStory = this.add
      .text(0, 52, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#cfc8e0",
        align: "center",
        wordWrap: { width: 320 },
      })
      .setOrigin(0.5, 0);
    this.study = this.add
      .container(0, 0, [this.studyBg, this.studyK, this.studyKw, this.studyPrim, this.studyStory])
      .setDepth(19)
      .setVisible(false);

    this.ordealBanner = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#f2c14e",
        backgroundColor: "#000000aa",
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setDepth(14)
      .setVisible(false);
    this.ordealBarBg = this.add
      .rectangle(0, 0, 220, 5, 0xffffff, 0.14)
      .setOrigin(0.5, 0)
      .setDepth(14)
      .setVisible(false);
    // A gold→ember gradient bar that drains via scaleX (gold end lingers last).
    this.ordealBar = this.add
      .image(0, 0, "timerbar")
      .setOrigin(0, 0)
      .setDepth(15)
      .setVisible(false);
  }

  // The pause codex: TAB/ESC freezes the dungeon and lists owned relics with
  // their full effect text (the HUD shelf only shows glyphs) plus run stats.
  private buildCodex() {
    this.codexDim = this.add
      .rectangle(0, 0, 10, 10, 0x0b0912, 0.82)
      .setOrigin(0, 0)
      .setDepth(30)
      .setVisible(false);
    this.codexBg = this.add
      .rectangle(0, 0, 580, 480, 0x14111f, 0.98)
      .setStrokeStyle(1, 0xf2c14e, 0.4);
    this.codexTitle = this.add
      .text(0, 0, "KOTODAMA CODEX", {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#f2c14e",
      })
      .setOrigin(0.5, 0);
    this.codexStats = this.add
      .text(0, 0, "", { fontFamily: "monospace", fontSize: "13px", color: "#9a94b0" })
      .setOrigin(0.5, 0);
    this.codexBody = this.add
      .text(0, 0, "", {
        fontFamily: '"Hiragino Mincho ProN","Yu Mincho",monospace',
        fontSize: "13px",
        color: "#e8e2f0",
        align: "left",
        lineSpacing: 5,
        wordWrap: { width: 520 },
      })
      .setOrigin(0.5, 0);
    this.codexFoot = this.add
      .text(0, 0, "TAB / ESC — resume", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#8f88a6",
      })
      .setOrigin(0.5, 0);
    this.codex = this.add
      .container(0, 0, [
        this.codexBg,
        this.codexTitle,
        this.codexStats,
        this.codexBody,
        this.codexFoot,
      ])
      .setDepth(31)
      .setVisible(false);
  }

  // Build the touch-only on-screen buttons and make the corner indicators tappable.
  private buildTouchControls() {
    this.menuBtn = this.makeIconButton("≡", "uiPause");
    this.cycleBtn = this.makeIconButton("⇄", "uiCycle").setVisible(false);
    this.healBtn = this.makeIconButton("＋", "uiHeal").setVisible(false);
    this.difficultyInd.setInteractive({ useHandCursor: true });
    this.difficultyInd.on("pointerdown", () => this.game.events.emit("uiDifficulty"));
    this.muteInd.setInteractive({ useHandCursor: true });
    this.muteInd.on("pointerdown", () => this.game.events.emit("muteChanged", sfx.toggleMute()));
    this.tapZones = [this.menuBtn, this.cycleBtn, this.healBtn, this.difficultyInd, this.muteInd];
  }

  // A round icon button: a filled disc + glyph, emitting `event` on tap. Container
  // needs an explicit circular hit area (it has no intrinsic size).
  private makeIconButton(icon: string, event: string): Phaser.GameObjects.Container {
    const R = 22;
    const disc = this.add.circle(0, 0, R, 0x14111f, 0.9).setStrokeStyle(1.5, 0xf2c14e, 0.7);
    const glyph = this.add
      .text(0, 0, icon, { fontFamily: "monospace", fontSize: "22px", color: "#f4e7c0" })
      .setOrigin(0.5);
    const c = this.add.container(0, 0, [disc, glyph]).setDepth(22);
    c.setInteractive(new Phaser.Geom.Circle(0, 0, R), Phaser.Geom.Circle.Contains);
    c.on("pointerdown", () => this.game.events.emit(event));
    return c;
  }

  // Per-frame: set which touch buttons are showing, then publish the visible
  // tap-targets' screen rects so DungeonScene ignores taps that land on them.
  private refreshTouchButtons() {
    if (!this.isTouch) return;
    this.cycleBtn?.setVisible(this.focusing);
    const canHeal =
      this.focusing && run.relics.has("oracles-tokens") && run.reveals > 0 && run.hp < run.maxHp;
    this.healBtn?.setVisible(canHeal);
    touch.buttons = this.tapZones
      .filter((o) => (o as unknown as Phaser.GameObjects.Components.Visible).visible)
      .map((o) => {
        const b = (o as unknown as Phaser.GameObjects.Components.GetBounds).getBounds();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      });
  }

  private toggleCodex(open: boolean) {
    this.codexOpen = open;
    if (open) {
      this.fillCodex();
      this.codexDim.setPosition(0, 0).setSize(this.scale.width, this.scale.height).setVisible(true);
      this.codex.setPosition(this.scale.width / 2, this.scale.height / 2).setVisible(true);
    } else {
      this.codexDim.setVisible(false);
      this.codex.setVisible(false);
    }
  }

  // Lay the panel out top-down and size the background to its content so a
  // 2-relic run and a 12-relic run both look intentional.
  private fillCodex() {
    this.codexStats.setText(
      `floor ${run.depth + 1}  ·  ♥ ${run.hp}/${run.maxHp}  ·  bound ${run.bound}  ·  streak ${run.streak}`,
    );
    const owned = [...run.relics];
    this.codexBody.setText(
      owned.length
        ? owned
            .map((id) => `${RELIC_MAP[id].jp}  ${RELIC_MAP[id].name}\n    ${RELIC_MAP[id].effect}`)
            .join("\n\n")
        : "No kotodama bound yet.\nClear an elite or the boss to be offered one.",
    );

    const PADT = 26;
    let y = -0; // filled after we know the height
    const bodyH = this.codexBody.height;
    const totalH = PADT + 22 + 10 + 16 + 18 + bodyH + 22 + 16 + PADT;
    const top = -totalH / 2;
    y = top + PADT;
    this.codexTitle.setPosition(0, y);
    y += 22 + 10;
    this.codexStats.setPosition(0, y);
    y += 16 + 18;
    this.codexBody.setPosition(0, y);
    y += bodyH + 22;
    this.codexFoot.setPosition(0, y);
    this.codexBg.setSize(580, totalH);
  }

  private onOrdealNeed(info: OrdealInfo) {
    const done = info.total - info.remaining + 1;
    const kind = info.boss ? "⟡ BOSS" : "⟡ ELITE";
    this.ordealBanner
      .setText(`${kind} — read: ${info.keyword}   (${done}/${info.total})`)
      .setPosition(this.scale.width / 2, PAD + 34)
      .setVisible(true);
    const b = this.ordealBanner.getBounds();
    this.tweens.killTweensOf(this.ordealBar);
    if (info.timed) {
      const barW = 220;
      this.ordealBarBg
        .setPosition(this.scale.width / 2, b.bottom + 6)
        .setSize(barW, 5)
        .setVisible(true);
      this.ordealBar
        .setPosition(this.scale.width / 2 - barW / 2, b.bottom + 6)
        .setVisible(true)
        .setDisplaySize(barW, 5);
      const t = this.tweens.add({
        targets: this.ordealBar,
        scaleX: 0,
        duration: info.seconds * 1000,
        ease: "Linear",
      });
      // Match the boss clock, which drains at half-rate while a read is held —
      // covers a need re-issued mid-read (timer lapse during Focus).
      if (this.focusing) t.timeScale = 0.5;
    } else {
      this.ordealBarBg.setVisible(false);
      this.ordealBar.setVisible(false);
    }
  }

  private onOrdealEnd() {
    this.tweens.killTweensOf(this.ordealBar);
    this.ordealBar.setScale(1);
    this.ordealBanner.setVisible(false);
    this.ordealBarBg.setVisible(false);
    this.ordealBar.setVisible(false);
  }

  private onFloorClear(nextDepth: number) {
    this.readToast
      .setText(`⬇  Floor ${nextDepth} — descending…`)
      .setColor("#f2c14e")
      .setPosition(this.scale.width / 2, this.scale.height / 2)
      .setAlpha(1)
      .setData("yFrac", 0.5)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: 1100,
      duration: 450,
      onComplete: () => this.readToast.setVisible(false),
    });
  }

  private onGauntletStart() {
    this.readToast
      .setText("⚔ gauntlet — survive the swarm")
      .setColor("#ff9d5c")
      .setPosition(this.scale.width / 2, this.scale.height * 0.3)
      .setAlpha(1)
      .setData("yFrac", 0.3)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: 1600,
      duration: 500,
      onComplete: () => this.readToast.setVisible(false),
    });
  }

  private onMagpieSteal(amt: number) {
    this.flashToast(`✦ a Magpie snatched ◈ ${amt}!`, "#ff9d5c", 1200);
  }

  private onMagpieCaught(amt: number) {
    this.flashToast(`✦ Magpie bound — ◈ ${amt} recovered`, "#5fd98a", 1400);
  }

  private flashToast(text: string, color: string, hold: number) {
    this.readToast
      .setText(text)
      .setColor(color)
      .setPosition(this.scale.width / 2, this.scale.height * 0.3)
      .setAlpha(1)
      .setData("yFrac", 0.3)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: hold,
      duration: 500,
      onComplete: () => this.readToast.setVisible(false),
    });
  }

  private onMeetKind(kind: string) {
    const guide: Record<string, { text: string; color: string }> = {
      wisp: { text: "✦ a Wisp — harmless; catch it for a heart", color: "#ffd24a" },
      shade: { text: "◈ a Shade — read it only while it surfaces", color: "#b0b0d8" },
      thief: { text: "✦ a Magpie — it steals ◈; catch it for a bounty", color: "#5fd98a" },
    };
    const g = guide[kind];
    if (!g) return;
    this.readToast
      .setText(g.text)
      .setColor(g.color)
      .setPosition(this.scale.width / 2, this.scale.height * 0.3)
      .setAlpha(1)
      .setData("yFrac", 0.3)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: 2400,
      duration: 500,
      onComplete: () => this.readToast.setVisible(false),
    });
  }

  private onBossPhasing() {
    this.readToast
      .setText("◈ the twins fade — strike as they surface")
      .setColor("#b79cff")
      .setPosition(this.scale.width / 2, this.scale.height * 0.3)
      .setAlpha(1)
      .setData("yFrac", 0.3)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: 2200,
      duration: 500,
      onComplete: () => this.readToast.setVisible(false),
    });
  }

  private onGauntletClear() {
    this.readToast
      .setText("⚔ gauntlet survived — healed to full")
      .setColor("#6be089")
      .setPosition(this.scale.width / 2, this.scale.height * 0.3)
      .setAlpha(1)
      .setData("yFrac", 0.3)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: 1600,
      duration: 500,
      onComplete: () => this.readToast.setVisible(false),
    });
  }

  private onShielded() {
    this.readToast
      .setText("◈ shielded — bind the Warden first")
      .setColor("#b79cff")
      .setPosition(this.scale.width / 2, this.scale.height * 0.26)
      .setAlpha(1)
      .setData("yFrac", 0.26)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: 1100,
      duration: 400,
      onComplete: () => this.readToast.setVisible(false),
    });
  }

  private onShrineBless() {
    this.readToast
      .setText("⛩ kotodama shrine — +2 hearts, a Ward banked")
      .setColor("#bfe6ff")
      .setPosition(this.scale.width / 2, this.scale.height * 0.3)
      .setAlpha(1)
      .setData("yFrac", 0.3)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: 1800,
      duration: 500,
      onComplete: () => this.readToast.setVisible(false),
    });
  }

  private onRead(info: ReadInfo) {
    this.readToast
      .setText(`${info.kanji} = ${info.keyword}  ${info.ok ? "✓" : "✗"}`)
      .setColor(info.ok ? "#6be089" : "#ff6b5c")
      .setPosition(this.scale.width / 2, this.scale.height * 0.26)
      .setAlpha(1)
      .setData("yFrac", 0.26)
      .setVisible(true);
    this.tweens.killTweensOf(this.readToast);
    this.tweens.add({
      targets: this.readToast,
      alpha: 0,
      delay: 900,
      duration: 400,
      onComplete: () => this.readToast.setVisible(false),
    });

    // Surface the mnemonic: always on a miss (the failure teaches best), and on a
    // forged hit too — you just built it from its parts, so cement the story.
    const teach = info.story && (!info.ok || info.forged);
    if (teach) {
      const hold = info.ok ? 1500 : 2600;
      this.teachToast
        .setText(`${info.kanji}  ${info.keyword}\n${info.story}`)
        .setPosition(this.scale.width / 2, this.scale.height * 0.8)
        .setAlpha(1)
        .setData("yFrac", 0.8)
        .setVisible(true);
      this.tweens.killTweensOf(this.teachToast);
      this.tweens.add({
        targets: this.teachToast,
        alpha: 0,
        delay: hold,
        duration: 500,
        onComplete: () => this.teachToast.setVisible(false),
      });
    }
  }

  private onStudyShow(info: StudyInfo) {
    this.study.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.studyK.setText(info.kanji);
    this.studyKw.setText(`new — ${info.keyword}`);
    this.studyPrim.setText(info.primitives.length ? info.primitives.join("  +  ") : "a primitive");
    this.studyStory.setText(info.story);
    this.study.setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this.study);
    this.tweens.add({
      targets: this.study,
      alpha: 0,
      delay: 4200,
      duration: 600,
      onComplete: () => this.study.setVisible(false),
    });
  }

  private hideStudy() {
    this.tweens.killTweensOf(this.study);
    this.study.setVisible(false);
    this.tweens.killTweensOf(this.teachToast);
    this.teachToast.setVisible(false);
  }

  private onFocusStart(info: FocusInfo) {
    this.focusing = true;
    this.focusKanji = info.kanji;
    this.hubGlyph.setText(info.kanji);
    // The boss clock drains at half-rate during a read, so slow the bar to match.
    this.tweens.getTweensOf(this.ordealBar).forEach((t) => (t.timeScale = 0.5));
    // Mode + first draw arrive with forgeRing / forgeWheel, emitted right after.
  }

  // A primitive recognition ring: the shape in the hub, candidate keywords around.
  private onForgeRing(info: ForgeRingInfo) {
    this.forgeMode = true;
    this.ringStage = info.stage;
    this.ringTotal = info.total;
    this.ringFace = info.faceText;
    this.ringRtk = info.faceRtk;
    this.ringChoices = info.choices;
    this.ringFaces = info.faces;
    this.ringKanji = info.kanji;
    this.drawBreadcrumb();
    this.applyOverlayMode();
    this.drawRing();
  }

  // The forge trail: each primitive shape then the compound kanji, in a centered
  // row above the ring; the current stage is boxed gold, the rest faint.
  private drawBreadcrumb() {
    const cx = this.scale.width / 2;
    const radius = Math.min(this.scale.width, this.scale.height) * WHEEL_RADIUS_FRAC;
    const y = this.scale.height / 2 - radius - 42;
    const seq = [...this.ringFaces, { text: this.ringKanji, rtk: false }];
    const count = Math.min(seq.length, this.crumbTexts.length);
    this.ringCrumbCount = count;
    const gap = 24;
    const widths: number[] = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const t = this.crumbTexts[i];
      t.setFontFamily(seq[i].rtk ? RTK_FONT : GLYPH_FONT).setText(seq[i].text);
      widths.push(t.width);
      total += t.width;
    }
    total += gap * Math.max(0, count - 1);
    let x = cx - total / 2;
    this.crumbG.clear();
    for (let i = 0; i < count; i++) {
      const w = widths[i];
      const gx = x + w / 2;
      const isKanji = i === count - 1;
      const current = i === this.ringStage;
      this.crumbTexts[i]
        .setPosition(gx, y)
        .setColor(current ? "#f2c14e" : isKanji ? "#f4ecd6" : "#6a6480");
      if (current) {
        this.crumbG.lineStyle(1.5, 0xf2c14e, 0.9);
        this.crumbG.strokeRoundedRect(gx - w / 2 - 6, y - 18, w + 12, 36, 8);
      }
      if (i < count - 1) {
        this.crumbG.lineStyle(1, 0xffffff, 0.2);
        this.crumbG.lineBetween(x + w + 6, y, x + w + gap - 6, y);
      }
      x += w + gap;
    }
  }

  // Every primitive named — hand off to the verb wheel (also the atomic-kanji path).
  private onForgeWheel(info: ForgeWheelInfo) {
    this.forgeMode = false;
    this.wheelWords = new Map(info.words.map((w) => [w.verb, w.word]));
    this.applyOverlayMode();
    this.drawWheel();
  }

  private onFocusEnd() {
    this.focusing = false;
    this.forgeMode = false;
    this.wheelWords.clear();
    this.applyOverlayMode();
    this.tweens.getTweensOf(this.ordealBar).forEach((t) => (t.timeScale = 1));
  }

  // One pooled chip per possible relic — a rounded pill: glyph badge + name.
  private buildRelicChips() {
    for (let i = 0; i < RELIC_IDS.length; i++) {
      const bg = this.add.graphics();
      const jp = this.add
        .text(0, 0, "", { fontFamily: GLYPH_FONT, fontSize: "14px", color: "#f2c14e" })
        .setOrigin(0, 0.5);
      const name = this.add
        .text(0, 0, "", { fontFamily: "monospace", fontSize: "11px", color: "#e8e2f0" })
        .setOrigin(0, 0.5);
      const c = this.add.container(0, 0, [bg, jp, name]).setDepth(2).setVisible(false);
      this.relicChips.push({ c, bg, jp, name });
    }
  }

  // Lay out owned relics as pill chips along the bottom-left, wrapping upward,
  // above the mute/difficulty indicators. The Oracle's Tokens chip shows charges.
  private drawRelics() {
    const owned = [...run.relics];
    const startX = PAD;
    const baseY = this.scale.height - PAD - 52;
    const gap = 7;
    const padX = 8;
    const badgeGap = 6;
    const h = 22;
    const maxX = this.scale.width * 0.62;
    let x = startX;
    let row = 0;
    this.relicChips.forEach((chip, i) => {
      if (i >= owned.length) {
        chip.c.setVisible(false);
        return;
      }
      const id = owned[i];
      chip.jp.setText(RELIC_MAP[id].jp);
      chip.name.setText(
        id === "oracles-tokens" ? `${RELIC_MAP[id].name}  ◆${run.reveals}` : RELIC_MAP[id].name,
      );
      const w = padX + chip.jp.width + badgeGap + chip.name.width + padX;
      if (x + w > maxX && x > startX) {
        x = startX;
        row += 1;
      }
      const y = baseY - row * (h + 6);
      chip.bg.clear();
      chip.bg.fillStyle(0x14111f, 0.9);
      chip.bg.fillRoundedRect(0, -h / 2, w, h, h / 2);
      chip.bg.lineStyle(1, 0xffffff, 0.12);
      chip.bg.strokeRoundedRect(0, -h / 2, w, h, h / 2);
      chip.jp.setPosition(padX, 0);
      chip.name.setPosition(padX + chip.jp.width + badgeGap, 0);
      chip.c.setPosition(x, y).setVisible(true);
      x += w + gap;
    });
  }

  // Show the overlay pieces for the current state: veil + hub always while
  // focusing; wheel-only pieces in wheel mode; candidate labels in ring mode.
  private applyOverlayMode() {
    const on = this.focusing;
    const wheel = on && !this.forgeMode;
    const ring = on && this.forgeMode;
    this.veil.setVisible(on);
    this.hub.setVisible(on);
    this.hubGlyph.setVisible(on);
    this.hubHint.setVisible(on);
    this.wheelG.setVisible(wheel);
    for (const s of this.sigils) s.setVisible(wheel);
    // Only worded spokes show a label; drawWheel toggles which as it renders.
    this.wheelLabels.forEach((t, i) => t.setVisible(wheel && this.wheelWords.has(WHEEL_ORDER[i])));
    this.ringCue.setVisible(ring);
    this.candTexts.forEach((t, i) => t.setVisible(ring && i < this.ringChoices.length));
    this.ringChipsG.setVisible(ring);
    this.crumbG.setVisible(ring);
    this.crumbTexts.forEach((t, i) => t.setVisible(ring && i < this.ringCrumbCount));
  }

  private drawWheel() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const radius = Math.min(this.scale.width, this.scale.height) * WHEEL_RADIUS_FRAC;
    // Draw the cancel hub at the SAME fraction the bind logic treats as dead-zone,
    // so what looks like "release to cancel" actually cancels.
    const dzFrac = run.relics.has("steady-tongue") ? 0.18 : WHEEL_DEADZONE;
    const inner = radius * dzFrac;
    const p = this.aimPoint();
    const aimed = wheelVerbAt(cx, cy, p.x, p.y, radius, dzFrac);

    this.veil.setPosition(0, 0).setSize(this.scale.width, this.scale.height);
    this.hub.setPosition(cx, cy).setRadius(inner);
    // Restore the kanji in the hub (a preceding primitive ring left its shape here).
    this.hubGlyph.setFontFamily(GLYPH_FONT).setText(this.focusKanji).setPosition(cx, cy);
    this.hubHint.setText("").setPosition(cx, cy + inner + 6);

    const g = this.wheelG;
    g.clear();
    WHEEL_ORDER.forEach((id, i) => {
      const { start, end, mid } = segmentAngles(i);
      const word = this.wheelWords.get(id);
      const worded = word != null;
      // Only worded spokes are selectable; a wordless spoke never highlights.
      const on = worded && id === aimed;
      g.fillStyle(VERB_MAP[id].color, on ? 0.92 : worded ? 0.34 : 0.04);
      g.slice(cx, cy, radius, start, end, false);
      g.fillPath();
      g.lineStyle(1, 0x0b0912, 0.6);
      g.beginPath();
      g.arc(cx, cy, radius, start, end, false);
      g.strokePath();

      const lr = (radius + inner) / 2;
      const sx = cx + Math.cos(mid) * lr;
      const sy = cy + Math.sin(mid) * lr;
      const sz = radius * (on ? 0.2 : 0.16);
      const s = this.sigils[i];
      s.setPosition(sx, sy).setDisplaySize(sz, sz);
      // Dark on the bright picked slice, else the verb's own colour; greyed if wordless.
      s.setTint(on ? 0x0b0912 : VERB_MAP[id].color);
      s.setAlpha(worded ? 1 : 0.12);

      // Worded spokes carry a keyword out toward the rim — one is the true reading,
      // the rest are real-but-wrong deck words. The player picks the right one.
      const label = this.wheelLabels[i];
      if (worded) {
        const kr = radius - 8;
        label
          .setText(word)
          .setPosition(cx + Math.cos(mid) * kr, cy + Math.sin(mid) * kr)
          .setColor(on ? "#0b0912" : "#f7ecc9");
      }
    });
  }

  // A primitive recognition ring: the shape sits in the hub, candidate keywords
  // ride the rim. The aimed candidate (shared pointer math) is highlighted; a
  // left-click commits it in DungeonScene.
  private drawRing() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const radius = Math.min(this.scale.width, this.scale.height) * WHEEL_RADIUS_FRAC;
    const dzFrac = run.relics.has("steady-tongue") ? 0.18 : WHEEL_DEADZONE;
    const inner = radius * dzFrac;
    const n = this.ringChoices.length;
    const p = this.aimPoint();
    const picked = n > 0 ? radialIndexAt(cx, cy, p.x, p.y, radius, dzFrac, n) : null;

    this.veil.setPosition(0, 0).setSize(this.scale.width, this.scale.height);
    this.hub.setPosition(cx, cy).setRadius(inner);
    this.hubGlyph
      .setFontFamily(this.ringRtk ? RTK_FONT : GLYPH_FONT)
      .setText(this.ringFace)
      .setPosition(cx, cy);
    this.ringCue.setPosition(cx, cy + inner + 6);
    this.hubHint
      .setText(`PRIMITIVE ${this.ringStage + 1} / ${this.ringTotal}`)
      .setPosition(cx, cy + inner + 22);

    const g = this.ringChipsG;
    g.clear();
    const lr = (radius + inner) / 2;
    this.ringChoices.forEach((kw, i) => {
      const mid = slotMid(i, n);
      const on = i === picked;
      const t = this.candTexts[i];
      t.setText(kw)
        .setPosition(cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr)
        .setColor(on ? "#7ad1c4" : "#cfc8e0")
        .setScale(on ? 1.12 : 1);
      // A rounded pill behind each candidate — jade outline on the aimed one.
      const w = t.width * (on ? 1.12 : 1) + 18;
      const h = 24;
      g.fillStyle(0x14111f, on ? 0.95 : 0.85);
      g.fillRoundedRect(t.x - w / 2, t.y - h / 2, w, h, h / 2);
      g.lineStyle(on ? 2 : 1, on ? 0x7ad1c4 : 0xffffff, on ? 0.9 : 0.12);
      g.strokeRoundedRect(t.x - w / 2, t.y - h / 2, w, h, h / 2);
    });
  }

  update() {
    this.drawJoystick();
    this.refreshTouchButtons();
    // Streak has no single event (shield/miss paths skip it); cheap dirty-check.
    if (run.streak !== this.lastStreak) {
      this.lastStreak = run.streak;
      this.streakText.setText(run.streak >= 2 ? `streak ${run.streak}` : "");
    }
    if (!this.focusing) return;
    if (this.forgeMode) this.drawRing();
    else this.drawWheel();
  }

  // The read is aimed by the read pointer's touch (a touch read) or the mouse.
  private aimPoint(): { x: number; y: number } {
    return touch.reading ? touch.aim : this.input.activePointer;
  }

  // The floating move-stick: a faint ring where the thumb landed and a knob at
  // the clamped thumb position. Drawn only while a touch drives it.
  private drawJoystick() {
    const g = this.joyG;
    g.clear();
    if (!touch.joyActive) return;
    g.lineStyle(2, 0xf4e7c0, 0.28);
    g.strokeCircle(touch.joyOrigin.x, touch.joyOrigin.y, JOY_RADIUS);
    g.fillStyle(0xf4e7c0, 0.22);
    g.fillCircle(touch.joyKnob.x, touch.joyKnob.y, 18);
    g.lineStyle(1.5, 0xf4e7c0, 0.5);
    g.strokeCircle(touch.joyKnob.x, touch.joyKnob.y, 18);
  }

  private onLock(locked: boolean) {
    this.hint.setVisible(locked);
  }

  private onMute(m: boolean) {
    this.muteInd.setText(m ? "♪ muted — M" : "♪ sound — M").setColor(m ? "#8f88a6" : "#d8ad33");
  }

  private onDifficulty(d: "easy" | "hard") {
    const easy = d === "easy";
    this.difficultyInd
      .setText(easy ? "◐ easy — H" : "● hard — H")
      .setColor(easy ? "#7ad6a0" : "#e0a35a");
    if (this.focusing) this.drawWheel();
  }

  private drawHearts() {
    const filled = Math.max(0, run.hp);
    const empty = Math.max(0, run.maxHp - run.hp);
    this.hearts.setText("♥".repeat(filled) + "♡".repeat(empty));
  }

  private drawPurse() {
    this.purse.setText(`◈ ${run.kotodama}`);
  }

  private layout() {
    this.hint.setPosition(this.scale.width / 2, this.scale.height - PAD);
    this.muteInd.setPosition(PAD, this.scale.height - PAD);
    this.difficultyInd.setPosition(PAD, this.scale.height - PAD - 16);
    // A faint rounded hairline frames the play area (the mockup's panel edge).
    this.frameGfx.clear();
    this.frameGfx.lineStyle(1, 0xffffff, 0.08);
    this.frameGfx.strokeRoundedRect(6, 6, this.scale.width - 12, this.scale.height - 12, 14);
    this.drawRelics();
    if (this.isTouch) {
      const w = this.scale.width;
      const h = this.scale.height;
      this.menuBtn?.setPosition(PAD + 24, PAD + 76); // top-left, clear of the joystick rest zone
      this.cycleBtn?.setPosition(w - PAD - 24, h / 2 - 30); // right edge, outside the centered wheel
      this.healBtn?.setPosition(w - PAD - 24, h / 2 + 30);
    }
    // Re-anchor any visible transient overlays so a resize doesn't strand them.
    for (const o of [this.ordealBanner, this.ordealBarBg, this.readToast, this.teachToast]) {
      if (o.visible) o.x = this.scale.width / 2;
    }
    for (const o of [this.readToast, this.teachToast]) {
      if (o.visible) o.y = this.scale.height * ((o.getData("yFrac") as number) ?? 0.5);
    }
    if (this.ordealBar.visible) this.ordealBar.x = this.scale.width / 2 - this.ordealBar.width / 2;
    if (this.study.visible) this.study.setPosition(this.scale.width / 2, this.scale.height / 2);
    if (this.codexOpen) {
      this.codexDim.setSize(this.scale.width, this.scale.height);
      this.codex.setPosition(this.scale.width / 2, this.scale.height / 2);
    }
    this.draw();
  }

  private draw() {
    const g = this.g;
    g.clear();
    if (!run.floor) return;

    const rooms = [...run.floor.rooms.values()];
    const minX = Math.min(...rooms.map((r) => r.gx));
    const maxX = Math.max(...rooms.map((r) => r.gx));
    const minY = Math.min(...rooms.map((r) => r.gy));
    const gridW = (maxX - minX + 1) * (CELL + GAP) - GAP;
    const originX = this.scale.width - PAD - gridW;
    const originY = PAD + 22;

    for (const room of rooms) {
      const k = key(room.gx, room.gy);
      const visited = run.visited.has(k);
      const x = originX + (room.gx - minX) * (CELL + GAP);
      const y = originY + (room.gy - minY) * (CELL + GAP);
      g.fillStyle(this.roomColor(room.type, k), visited ? 1 : 0.28);
      g.fillRect(x, y, CELL, CELL);
      if (room === run.current) {
        const sealed = !run.cleared.has(k);
        g.lineStyle(2, sealed ? 0xf4c95d : 0xffffff, 1);
        g.strokeRect(x - 1, y - 1, CELL + 2, CELL + 2);
      }
    }

    this.label.setText(`floor ${run.depth + 1} · seed ${run.seed}`);
    this.label.setOrigin(1, 0).setPosition(this.scale.width - PAD, PAD);
  }

  // Minimap colour reflects the SRS queue: study alcove = new, boss stays red,
  // combat rooms take their dominant card state (due/lapsed/new/known).
  private roomColor(type: RoomType, k: string): number {
    if (type === "start") return TYPE_COLOR.start;
    if (type === "shrine") return TYPE_COLOR.shrine;
    if (type === "shop") return TYPE_COLOR.shop;
    if (run.study.has(k)) return STATE_COLOR.new;
    if (run.gauntlet.has(k)) return 0xe08a3c;
    if (type === "boss") return TYPE_COLOR.boss;
    // Plain rooms resolve their role reactively on arrival; until then they carry
    // no roomState, so show the room-type colour rather than a misleading "new".
    const state = run.roomState.get(k);
    return state ? STATE_COLOR[state] : TYPE_COLOR[type];
  }
}
