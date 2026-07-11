import Phaser from "phaser";
import { sfx } from "../audio/sfx";
import { SPIRIT_BODY } from "../config";
import type { KanjiEntry } from "../rtk/corpus";
import { burstProfile, VERB_MAP } from "../rtk/verbs";

const GLYPH_FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Songti SC",serif';

// How a spirit moves. All stay near the player so they never wander into walls
// (the room has no spirit-vs-wall collider). chase = straight at you; orbit =
// circles you; drift = a lazy swaying approach; skittish = backs away while you're
// mid-read (shy word-spirit) and closes in otherwise; lurker = lies still until
// you come near or start reading, then lunges.
export type SpiritBehavior = "chase" | "orbit" | "drift" | "skittish" | "lurker";
const ORBIT_RADIUS = 120;
const LURK_RANGE = 46; // a lurker wakes when the player is this close (or reading)

// A kanji word-spirit. Renders its glyph over a verb-coloured aura + a pulsing
// "unread" ring; you bind it by reading its meaning (see DungeonScene). It's a
// Container with an arcade body — children are centred on the origin, so the
// body must be offset by -half to sit on top of them.
export default class Spirit extends Phaser.GameObjects.Container {
  readonly entry: KanjiEntry;
  readonly elite: boolean;
  readonly wisp: boolean;
  readonly warden: boolean;
  readonly shade: boolean;
  readonly thief: boolean;
  stealReadyAt = 0; // scene-set cooldown so a Magpie can't drain every frame
  stolen = 0; // kotodama it has snatched — returned (plus a bounty) when bound
  readonly behavior: SpiritBehavior;
  private phasedOut = false;
  private phaseEvent?: Phaser.Time.TimerEvent;
  private wanderPhase = Math.random() * Math.PI * 2;
  private aura: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Arc;
  private eliteRing?: Phaser.GameObjects.Arc;
  private glyph: Phaser.GameObjects.Text;
  private baseScale: number;
  private bound_ = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    entry: KanjiEntry,
    scale = 1,
    elite = false,
    behavior: SpiritBehavior = "chase",
    wisp = false,
    warden = false,
    shade = false,
    thief = false,
  ) {
    super(scene, x, y);
    this.entry = entry;
    this.elite = elite;
    this.wisp = wisp;
    this.warden = warden;
    this.shade = shade;
    this.thief = thief;
    // Wisps and Magpies are shy: always flee. (Magpies snatch on contact.)
    this.behavior = wisp || thief ? "skittish" : behavior;
    this.baseScale = scale;
    const color = wisp
      ? 0xffd24a
      : warden
        ? 0x9a6bff
        : shade
          ? 0x6a6a8a
          : thief
            ? 0x4fc76a
            : VERB_MAP[entry.verb].color;

    this.aura = scene.add
      .image(0, 0, "aura")
      .setTint(color)
      .setAlpha(warden ? 0.8 : elite ? 0.7 : 0.5);
    this.ring = scene.add
      .circle(0, 0, 15)
      .setStrokeStyle(warden ? 2.5 : 1.5, color, warden ? 0.85 : 0.6);
    this.glyph = scene.add
      .text(0, 0, entry.kanji, { fontFamily: GLYPH_FONT, fontSize: "22px", color: "#f4ecd6" })
      .setOrigin(0.5)
      .setResolution(3);
    // Global pixelArt forces NEAREST; kanji aren't pixel art, so force LINEAR.
    (this.glyph.texture as Phaser.Textures.Texture).setFilter(Phaser.Textures.FilterMode.LINEAR);

    const parts: Phaser.GameObjects.GameObject[] = [this.aura, this.ring, this.glyph];
    if (elite) {
      // A gold outer ring marks confusable/boss spirits — read the exact keyword.
      this.eliteRing = scene.add.circle(0, 0, 20).setStrokeStyle(2, 0xf2c14e, 0.85);
      parts.splice(2, 0, this.eliteRing);
    }
    this.add(parts);
    this.setScale(scale);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const b = this.body as Phaser.Physics.Arcade.Body;
    const size = SPIRIT_BODY * scale;
    b.setSize(size, size);
    b.setOffset(-size / 2, -size / 2);

    scene.tweens.add({
      targets: this.ring,
      alpha: { from: 0.3, to: 0.7 },
      scaleX: { from: 0.9, to: 1.2 },
      scaleY: { from: 0.9, to: 1.2 },
      duration: 900,
      yoyo: true,
      repeat: -1,
    });
    // A gentle float so idle spirits feel alive (glyph only — physics untouched).
    scene.tweens.add({
      targets: this.glyph,
      y: { from: -2, to: 2 },
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Shades phase in and out — only targetable (and tangible) while phased in.
    // A random head-start on the first cycle staggers twins so they don't all
    // vanish at once (a rotating window instead of all-or-nothing).
    if (shade) {
      this.phaseEvent = scene.time.addEvent({
        delay: 1400,
        startAt: Math.random() * 1400,
        loop: true,
        callback: this.togglePhase,
        callbackScope: this,
      });
    }
  }

  private togglePhase() {
    this.phasedOut = !this.phasedOut;
    this.scene.tweens.add({
      targets: this,
      alpha: this.phasedOut ? 0.12 : 1,
      duration: 300,
    });
  }

  // A phased-out shade can't be targeted or touched.
  get targetable() {
    return !this.phasedOut;
  }

  setTargeted(on: boolean) {
    const color = VERB_MAP[this.entry.verb].color;
    this.aura.setAlpha(on ? 0.9 : 0.5);
    this.glyph.setColor(on ? "#fff4d6" : "#f4ecd6");
    this.ring.setStrokeStyle(on ? 2.5 : 1.5, on ? 0xffe27a : color, on ? 0.95 : 0.6);
  }

  // Drive this frame's velocity toward the player per the spirit's behavior.
  // `speed` already carries the Focus slow-down. `focusing` lets skittish spirits
  // shy away from a read.
  steer(px: number, py: number, speed: number, focusing: boolean) {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const toAng = Math.atan2(py - this.y, px - this.x);
    switch (this.behavior) {
      case "orbit": {
        const dist = Math.hypot(px - this.x, py - this.y);
        const tang = toAng + Math.PI / 2; // tangential
        const pull = Phaser.Math.Clamp((dist - ORBIT_RADIUS) * 0.02, -1, 1);
        body.setVelocity(
          (Math.cos(tang) + Math.cos(toAng) * pull) * speed,
          (Math.sin(tang) + Math.sin(toAng) * pull) * speed,
        );
        break;
      }
      case "drift": {
        this.wanderPhase += 0.05;
        const sway = Math.sin(this.wanderPhase) * 0.7; // lazy sideways weave
        const ang = toAng + sway;
        body.setVelocity(Math.cos(ang) * speed * 0.7, Math.sin(ang) * speed * 0.7);
        break;
      }
      case "skittish": {
        const away = focusing ? -1 : 1; // back away from a read, else close in
        body.setVelocity(Math.cos(toAng) * speed * away, Math.sin(toAng) * speed * away);
        break;
      }
      case "lurker": {
        // Dormant until the player is near or reading — then it lunges hard.
        const dist = Math.hypot(px - this.x, py - this.y);
        if (dist < LURK_RANGE || focusing) {
          body.setVelocity(Math.cos(toAng) * speed * 1.5, Math.sin(toAng) * speed * 1.5);
        } else {
          body.setVelocity(0, 0);
        }
        break;
      }
      default: // chase
        this.scene.physics.moveTo(this, px, py, speed);
    }
  }

  // Wrong read: the spirit surges (its meaning lashes out). Damage is applied by
  // the scene; this is just the tell.
  surge() {
    // aura is a container child (resting scale 1); the container already carries
    // baseScale, so a fixed 1.5 pulses to ~1.5x regardless of spirit size.
    this.scene.tweens.add({
      targets: this.aura,
      alpha: 0.95,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 110,
      yoyo: true,
    });
    sfx.spiritSurge();
  }

  // Correct read: banished in a bright bloom + a burst of verb-coloured sparks.
  bind() {
    if (this.bound_) return;
    this.bound_ = true;
    this.phaseEvent?.remove(); // stop phasing so it can't fight the fade-out tween
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
    this.glyph.setColor("#ffe27a");
    sfx.bind();
    this.burst();
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scaleX: this.baseScale * 1.7,
      scaleY: this.baseScale * 1.7,
      duration: 280,
      ease: "Quad.easeOut",
      onComplete: () => this.destroy(),
    });
  }

  // Phaser's TweenManager only purges on scene shutdown, not on GameObject
  // destroy — so the idle repeat:-1 tweens must be killed here or they orphan
  // and keep mutating dead objects every frame for the rest of the run.
  destroy(fromScene?: boolean) {
    this.phaseEvent?.remove();
    this.scene?.tweens.killTweensOf([this.ring, this.glyph, this.aura, this]);
    super.destroy(fromScene);
  }

  private burst() {
    const color = VERB_MAP[this.entry.verb].color;
    const p = burstProfile(this.entry.verb);
    const em = this.scene.add.particles(this.x, this.y, "spark", {
      speed: { min: p.speedMin, max: p.speedMax },
      angle: { min: p.angleMin ?? 0, max: p.angleMax ?? 360 },
      gravityY: p.gravityY,
      lifespan: p.lifespan,
      scale: { start: p.scale * this.baseScale, end: 0 },
      quantity: 1,
      tint: [color, 0xffe27a],
      emitting: false,
    });
    em.setDepth(5);
    em.explode(p.quantity);
    this.scene.time.delayedCall(p.lifespan + 60, () => em.destroy());
  }

  get alive() {
    return !this.bound_;
  }
}
