import Phaser from "phaser";
import { Graphics } from "../graphics";
import { SIGIL_BOX, SIGILS, sigilKey } from "../rtk/sigils";
import { WHEEL_ORDER } from "../rtk/verbs";

// Loads assets + registers animations once, generates the spirit-aura texture,
// then hands off to the dungeon and its HUD overlay.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
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
    this.makeSigils();
    this.makePx();

    this.scene.start("title");
  }

  // A plain 16x16 white tile — used as an invisible, TILE-sized collider body for
  // walls and doors now that the environment is drawn procedurally. Sized to TILE
  // so a static body created from it defaults to the right collision box.
  private makePx() {
    if (this.textures.exists("px")) return;
    const s = 16;
    const tex = this.textures.createCanvas("px", s, s);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, s, s);
    tex.refresh();
  }

  // Rasterise each verb's sigil to a white canvas texture (tinted per verb on the
  // wheel). Rendered at 2x the authoring box for crisp scaling. Path2D draws the
  // authored sub-paths; evenodd cuts the hide mask's eye holes.
  private makeSigils() {
    const scale = 2;
    const size = SIGIL_BOX * scale;
    for (const verb of WHEEL_ORDER) {
      const key = sigilKey(verb);
      if (this.textures.exists(key)) continue;
      const tex = this.textures.createCanvas(key, size, size);
      if (!tex) continue;
      const ctx = tex.getContext();
      ctx.scale(scale, scale);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#fff";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // Never let a malformed path white-screen the game at boot — a failed sigil
      // just yields an empty texture (the spoke still works, sans icon).
      try {
        for (const part of SIGILS[verb]) {
          const path = new Path2D(part.d);
          if (part.w != null) {
            ctx.lineWidth = part.w;
            ctx.stroke(path);
          } else {
            ctx.fill(path, part.evenodd ? "evenodd" : "nonzero");
          }
        }
      } catch (e) {
        console.warn(`[arena] sigil "${verb}" failed to render`, e);
      }
      tex.refresh();
    }
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
