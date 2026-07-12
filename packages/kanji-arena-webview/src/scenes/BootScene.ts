import Phaser from "phaser";
import { SIGIL_BOX, SIGILS, sigilKey } from "../rtk/sigils";
import { WHEEL_ORDER } from "../rtk/verbs";

// Generates every runtime texture procedurally (aura, spark, sigils, collider
// tile, player peg), then hands off to the dungeon and its HUD overlay. The game
// ships no image assets — the whole look is drawn.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create() {
    this.makeAura();
    this.makeSpark();
    this.makeSigils();
    this.makePx();
    this.makePeg();
    this.makeReticle();

    this.scene.start("title");
  }

  // The gold targeting reticle: four arc segments with gaps, spun on the focus
  // target (Spirit shows/hides + rotates it). Transparent outside the arcs.
  private makeReticle() {
    if (this.textures.exists("reticle")) return;
    const size = 64;
    const tex = this.textures.createCanvas("reticle", size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    const c = size / 2;
    const r = 26;
    const gap = 0.42;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(c, c, r, i * (Math.PI / 2) + gap / 2, (i + 1) * (Math.PI / 2) - gap / 2);
      ctx.stroke();
    }
    tex.refresh();
  }

  // The player avatar: a soft-shadowed indigo peg with a pale head, drawn into a
  // 48x48 frame so the dungeon's body offset (14x14 @ 17,30) still lands on its base.
  private makePeg() {
    if (this.textures.exists("peg")) return;
    const s = 48;
    const tex = this.textures.createCanvas("peg", s, s);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(24, 41, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    this.roundRectPath(ctx, 15, 18, 18, 22, 9);
    ctx.fillStyle = "#463f73";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(150,138,210,0.55)";
    ctx.stroke();
    ctx.fillStyle = "#ece7f6";
    ctx.beginPath();
    ctx.ellipse(24, 15, 8, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    tex.refresh();
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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
