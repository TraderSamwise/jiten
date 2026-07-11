import Phaser from "phaser";
import { Graphics } from "../graphics";

// Loads assets + registers animations once, generates the spirit-aura texture,
// then hands off to the dungeon and its HUD overlay.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    const env = Graphics.environment;
    this.load.spritesheet(env.key, env.file, {
      frameWidth: env.width,
      frameHeight: env.height,
      margin: env.margin,
      spacing: env.spacing,
    });
    this.load.spritesheet(Graphics.player.key, Graphics.player.file, {
      frameWidth: Graphics.player.width,
      frameHeight: Graphics.player.height,
    });
  }

  create() {
    const p = Graphics.player.animations;
    for (const a of [p.idle, p.idleBack, p.walk, p.walkBack]) {
      if (this.anims.exists(a.key)) continue;
      this.anims.create({
        key: a.key,
        frames: this.anims.generateFrameNumbers(Graphics.player.key, {
          start: a.start,
          end: a.end,
        }),
        frameRate: a.frameRate,
        repeat: a.repeat,
      });
    }

    this.makeAura();
    this.makeSpark();

    this.scene.start("title");
  }

  // A soft radial disc used as the tintable glow behind each kanji spirit.
  private makeAura() {
    if (this.textures.exists("aura")) return;
    const size = 64;
    const tex = this.textures.createCanvas("aura", size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.45, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  // A tiny soft dot for the bind-burst particles.
  private makeSpark() {
    if (this.textures.exists("spark")) return;
    const s = 8;
    const tex = this.textures.createCanvas("spark", s, s);
    if (!tex) return;
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    tex.refresh();
  }
}
