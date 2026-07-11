import Phaser from "phaser";
import { sfx } from "../audio/sfx";
import { EASY_DIM_FRACTION, settings, WHEEL_DEADZONE, WHEEL_RADIUS_FRAC } from "../config";
import { run } from "../core/run";
import { key, RoomType } from "../dungeon/types";
import { STATE_COLOR } from "../rtk/srs";
import { RELIC_MAP } from "../rtk/relics";
import { sigilKey } from "../rtk/sigils";
import { VERB_MAP, VerbId, WHEEL_ORDER } from "../rtk/verbs";
import { segmentAngles, wheelVerbAt } from "../rtk/wheel";

interface FocusInfo {
  kanji: string;
  keyword: string; // the targeted spirit's realised keyword (shown on its spoke)
  answer: VerbId; // the correct verb — its spoke reveals the keyword
  primitives: string[];
  rusty: boolean;
}
interface ReadInfo {
  kanji: string;
  keyword: string;
  ok: boolean;
  story?: string;
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

const TYPE_COLOR: Record<RoomType, number> = {
  start: 0x4b5bd6,
  normal: 0x6b6f8c,
  boss: 0xc23a4b,
  treasure: 0xd8ad33,
  shrine: 0x5ab0e0,
  shop: 0x2fbfa8,
};

const GLYPH_FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Songti SC",serif';

// Minimap + hearts + the read-wheel overlay. Fixed to the screen (unzoomed), so
// it lives above the dungeon. The wheel is drawn in screen space; the highlighted
// verb is computed from the shared pointer, matching what DungeonScene resolves.
export default class HudScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private hearts!: Phaser.GameObjects.Text;
  private purse!: Phaser.GameObjects.Text;

  private veil!: Phaser.GameObjects.Rectangle;
  private wheelG!: Phaser.GameObjects.Graphics;
  private hub!: Phaser.GameObjects.Arc;
  private hubGlyph!: Phaser.GameObjects.Text;
  private sigils: Phaser.GameObjects.Image[] = [];
  private answerKw!: Phaser.GameObjects.Text; // realised keyword on the correct spoke
  private answerVerb: VerbId | null = null;
  private answerKeyword = "";
  private focusing = false;
  private relicShelf!: Phaser.GameObjects.Text;
  private muteInd!: Phaser.GameObjects.Text;
  private difficultyInd!: Phaser.GameObjects.Text;
  // Verbs no spirit in the current room uses; a subset is dimmed in easy mode.
  private dimmedVerbs = new Set<VerbId>();

  private hubHint!: Phaser.GameObjects.Text;
  private readToast!: Phaser.GameObjects.Text;
  private teachToast!: Phaser.GameObjects.Text;
  private ordealBanner!: Phaser.GameObjects.Text;
  private ordealBarBg!: Phaser.GameObjects.Rectangle;
  private ordealBar!: Phaser.GameObjects.Rectangle;
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

  constructor() {
    super("hud");
  }

  create() {
    this.g = this.add.graphics();
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
      .text(0, 0, "Sealed — read the spirits  (hold SPACE, aim, release · Q switches target)", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#f4e7c0",
        backgroundColor: "#00000088",
        padding: { x: 10, y: 6 },
      })
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

    this.relicShelf = this.add
      .text(0, 0, "", {
        fontFamily: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif',
        fontSize: "20px",
        color: "#f2c14e",
        align: "right",
      })
      .setOrigin(1, 1);

    this.buildWheel();
    this.buildOverlays();
    this.buildCodex();

    this.game.events.on("roomChanged", this.draw, this);
    this.game.events.on("roomChanged", this.hideStudy, this);
    this.game.events.on("roomChanged", this.computeDimmed, this);
    this.game.events.on("difficultyChanged", this.onDifficulty, this);
    this.game.events.on("muteChanged", this.onMute, this);
    this.game.events.on("lockState", this.onLock, this);
    this.game.events.on("hpChanged", this.drawHearts, this);
    this.game.events.on("kotodamaChanged", this.drawPurse, this);
    this.game.events.on("roomChanged", this.drawPurse, this);
    this.game.events.on("focusStart", this.onFocusStart, this);
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
      this.game.events.off("roomChanged", this.computeDimmed, this);
      this.game.events.off("difficultyChanged", this.onDifficulty, this);
      this.game.events.off("muteChanged", this.onMute, this);
      this.game.events.off("lockState", this.onLock, this);
      this.game.events.off("hpChanged", this.drawHearts, this);
      this.game.events.off("kotodamaChanged", this.drawPurse, this);
      this.game.events.off("roomChanged", this.drawPurse, this);
      this.game.events.off("focusStart", this.onFocusStart, this);
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
    this.computeDimmed();
  }

  private buildWheel() {
    this.veil = this.add
      .rectangle(0, 0, 10, 10, 0x0b0912, 0.5)
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
    this.answerKw = this.add
      .text(0, 0, "", { fontFamily: GLYPH_FONT, fontSize: "15px", color: "#f7ecc9" })
      .setOrigin(0.5)
      .setDepth(14)
      .setVisible(false);
  }

  private buildOverlays() {
    this.hubHint = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#cfc8e0",
        align: "center",
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
    this.ordealBar = this.add
      .rectangle(0, 0, 220, 5, 0xe2493b, 0.95)
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
        .setSize(barW, 5)
        .setScale(1)
        .setVisible(true);
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

    if (!info.ok && info.story) {
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
        delay: 2600,
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
    this.answerVerb = info.answer;
    this.answerKeyword = info.keyword;
    this.hubGlyph.setText(info.kanji);
    // Rusty cards expose their component breakdown as a retrieval aid; blank when
    // the glyph has no parts (rather than the old confusing "a primitive").
    this.hubHint.setText(info.rusty ? info.primitives.join("  +  ") : "");
    this.setWheelVisible(true);
    // The boss clock drains at half-rate during a read, so slow the bar to match.
    this.tweens.getTweensOf(this.ordealBar).forEach((t) => (t.timeScale = 0.5));
    this.drawWheel();
  }

  private onFocusEnd() {
    this.focusing = false;
    this.answerVerb = null;
    this.setWheelVisible(false);
    this.tweens.getTweensOf(this.ordealBar).forEach((t) => (t.timeScale = 1));
  }

  private drawRelics() {
    const owned = [...run.relics].map((id) => RELIC_MAP[id].jp).join(" ");
    const reveals = run.relics.has("oracles-tokens") ? `  ◆${run.reveals}` : "";
    this.relicShelf.setText(owned ? owned + reveals : "");
  }

  private setWheelVisible(v: boolean) {
    this.veil.setVisible(v);
    this.wheelG.setVisible(v);
    this.hub.setVisible(v);
    this.hubGlyph.setVisible(v);
    this.hubHint.setVisible(v);
    for (const s of this.sigils) s.setVisible(v);
    this.answerKw.setVisible(v && this.answerVerb != null);
  }

  private drawWheel() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const radius = Math.min(this.scale.width, this.scale.height) * WHEEL_RADIUS_FRAC;
    // Draw the cancel hub at the SAME fraction the bind logic treats as dead-zone,
    // so what looks like "release to cancel" actually cancels.
    const dzFrac = run.relics.has("steady-tongue") ? 0.18 : WHEEL_DEADZONE;
    const inner = radius * dzFrac;
    const p = this.input.activePointer;
    const picked = wheelVerbAt(cx, cy, p.x, p.y, radius, dzFrac);

    this.veil.setPosition(0, 0).setSize(this.scale.width, this.scale.height);
    this.hub.setPosition(cx, cy).setRadius(inner);
    this.hubGlyph.setPosition(cx, cy);
    this.hubHint.setPosition(cx, cy + inner + 6);

    const easy = settings.difficulty === "easy";
    const g = this.wheelG;
    g.clear();
    WHEEL_ORDER.forEach((id, i) => {
      const { start, end, mid } = segmentAngles(i);
      const on = id === picked;
      const dimmed = easy && !on && this.dimmedVerbs.has(id);
      g.fillStyle(VERB_MAP[id].color, on ? 0.92 : dimmed ? 0.04 : 0.34);
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
      // Dark on the bright picked slice, else the verb's own colour.
      s.setTint(on ? 0x0b0912 : VERB_MAP[id].color);
      s.setAlpha(dimmed ? 0.15 : 1);

      // Always-reveal: the targeted spirit's keyword rides its correct spoke, out
      // toward the rim so it reads "sigil → keyword".
      if (id === this.answerVerb) {
        const kr = radius - 8;
        this.answerKw
          .setText(this.answerKeyword)
          .setPosition(cx + Math.cos(mid) * kr, cy + Math.sin(mid) * kr)
          .setColor(on ? "#0b0912" : "#f7ecc9");
      }
    });
  }

  update() {
    if (this.focusing) this.drawWheel();
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

  // Pick the room's "false" verbs (used by no spirit here) and dim a stable
  // subset of them — seeded per room so the choice holds while the wheel is open
  // and stays consistent on re-reads. Only applied to the draw in easy mode.
  private computeDimmed() {
    this.dimmedVerbs = new Set();
    const room = run.current;
    if (!room) return;
    const entries = run.content.get(key(room.gx, room.gy));
    if (!entries || entries.length === 0) return;
    const active = new Set(entries.map((e) => e.verb));
    const falseVerbs = WHEEL_ORDER.filter((id) => !active.has(id));
    const rng = new Phaser.Math.RandomDataGenerator([run.seed, key(room.gx, room.gy), "dim"]);
    const shuffled = rng.shuffle(falseVerbs.slice());
    const n = Math.floor(falseVerbs.length * EASY_DIM_FRACTION);
    for (let i = 0; i < n; i++) this.dimmedVerbs.add(shuffled[i]);
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
    this.relicShelf.setPosition(this.scale.width - PAD, this.scale.height - PAD);
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
