import Phaser from "phaser";
import {
  ATMOSPHERE,
  BG,
  DOOR_HALF,
  FOCUS_SLOW,
  GRID_COLS,
  GRID_ROWS,
  IFRAME_MS,
  KNOCKBACK,
  KNOCKBACK_MS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  ROOM_H,
  ROOM_INNER_H,
  ROOM_INNER_W,
  ROOM_PX_H,
  ROOM_PX_W,
  ROOM_W,
  settings,
  SPIRIT_SPEED,
  TARGET_ROOMS,
  TILE,
  WHEEL_DEADZONE,
  WHEEL_RADIUS_FRAC,
  wrongOptionCount,
} from "../config";
import { sfx } from "../audio/sfx";
import { run } from "../core/run";
import { nextRunSeed } from "../core/seed";
import { aimPoint, JOY_DEADZONE, JOY_RADIUS, resetTouch, touch } from "../core/touchControls";
import { generateFloor } from "../dungeon/generate";
import { Dir, key, OPPOSITE, Room } from "../dungeon/types";
import Spirit, { SpiritBehavior } from "../entities/Spirit";

const BEHAVIORS: SpiritBehavior[] = ["chase", "chase", "orbit", "drift", "skittish", "lurker"];
import { Graphics } from "../graphics";
import { CLUSTERS, CORPUS, KanjiEntry } from "../rtk/corpus";
import {
  buildPrimitiveChoices,
  type Choice,
  FALLBACK_KEYWORDS,
  hasShape,
  primitiveFace,
} from "../rtk/forge";
import { VerbId, WHEEL_ORDER } from "../rtk/verbs";
import { absorbBackfire, applyCorrectRead } from "../rtk/relicEffects";
import { RELIC_IDS, RelicId } from "../rtk/relics";
import type { ArenaPrimitive } from "../protocol";
import {
  combatOrder,
  freshOnes,
  isRusty,
  load,
  markSeen,
  pickClusters,
  recordResult,
  resetRun,
  reviewReady,
  SrsState,
  SrsStore,
  stateOf,
} from "../rtk/srs";
import { radialIndexAt, wheelVerbAt } from "../rtk/wheel";

const FLOOR_TINT: Partial<Record<Room["type"], number>> = {
  boss: 0xffb3b3,
  treasure: 0xffe6a0,
  shrine: 0xbfe6ff,
  shop: 0xbdf0e6,
};

// Component-wise multiply of two packed RGB colours (0xRRGGBB) — used to fold a
// special-room floor tint into the global violet grade.
function mulHex(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 255) * ((b >> 16) & 255)) / 255);
  const g = Math.round((((a >> 8) & 255) * ((b >> 8) & 255)) / 255);
  const bl = Math.round(((a & 255) * (b & 255)) / 255);
  return (r << 16) | (g << 8) | bl;
}

const CCOL = Math.floor(ROOM_W / 2);
const CROW = Math.floor(ROOM_H / 2);
const LAND_INSET = 3;
const ORDEAL_SECONDS = 7; // per-need boss timer at floor 1; tightens with depth
const ORDEAL_SECONDS_MIN = 4;
const MAX_EXTRA_SPIRITS = 3; // deeper floors pack more spirits per combat room
const COMBAT_MIN = 1; // review-ready kanji needed to make a room combat; else it teaches

// Boss-only telegraphed danger patches: keep moving while you read under the clock.
// Sized to the ~240x144px room interior — small enough to leave dodge room.
const HAZARD_TELEGRAPH = 850; // warning window before a patch detonates (ms)
const HAZARD_INTERVAL = 2600; // between waves (ms)
const HAZARD_RADIUS = 24; // ~1.5 tiles
const HAZARD_COUNT = 2; // patches per wave at floor 1
const HAZARD_COUNT_MAX = 4; // deeper floors add patches, capped here

const LOCKS = (r: Room) => r.type === "normal" || r.type === "boss";

export default class DungeonScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private doors!: Phaser.Physics.Arcade.StaticGroup;
  private haze?: Phaser.GameObjects.Image; // ambient violet fog, tracks camera centre
  private playerLight?: Phaser.GameObjects.Image; // soft light pool under the hero
  private spirits!: Phaser.Physics.Arcade.Group;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private focusKey!: Phaser.Input.Keyboard.Key;
  private cycleKey!: Phaser.Input.Keyboard.Key;
  private facingBack = false;
  private transitioning = false;
  private combatActive = false;
  private invulnUntil = 0;
  private knockbackUntil = 0;
  private dead = false;
  private focusing = false;
  private paused = false;
  private pausedAt = 0;
  private hazards: {
    gfx: Phaser.GameObjects.Arc;
    x: number;
    y: number;
    detonateAt: number;
    telegraph: number;
  }[] = [];
  private nextHazardAt = 0;
  private focusTarget: Spirit | null = null;
  // The Forge: reading a spirit names each of its primitives (a recognition ring)
  // before the verb wheel. forgeStage indexes forgePlan; at forgeStage ===
  // forgePlan.length the read is on the wheel. Atomic kanji have an empty plan and
  // go straight to the wheel — identical to the pre-Forge read.
  private forgePlan: ArenaPrimitive[] = [];
  private forgeStage = 0;
  private forgeChoices: Choice[] = [];
  // The verb spokes that show a word this read: the correct verb → the kanji's
  // keyword, plus difficulty-many wrong verbs → real (but wrong) deck keywords.
  // Spokes absent here are greyed and unselectable. Deterministic per kanji.
  private wheelWords = new Map<VerbId, string>();
  private forgeWrong = 0; // wrong-option count snapshot for the read (fixed at focus)
  private primePrev = false; // left-button edge latch for committing a forge ring
  private focusConsumed = false; // block re-focus until the focus button is released
  private isTouch = false; // this device drives input by touch, not mouse+keyboard
  private joyId: number | null = null; // pointer id currently owning the move stick
  private readId: number | null = null; // pointer id currently aiming the read
  private srs: SrsStore = {};
  private ordealNeeds: string[] | null = null;
  private ordealTimed = false;
  private ordealTotal = 0;
  private needDeadline = 0;
  private firstReadUsed = false; // First Word relic: one free misread per room
  private firstBindUsed = false; // Mind's Eye (First Sight): one bonus bind per room
  private blessed = new Set<string>(); // shrine rooms already claimed this floor
  private shopped = new Set<string>(); // shop rooms already visited this floor
  private introduced = new Set<string>(); // spirit kinds already field-guided this run
  private ordealForgiven = false; // Twin-Ward relic: one free wrong twin per need
  // Set when an all-new boss becomes a naming rite; studying it descends the floor.
  private bossStudyDescend: string | null = null;
  private revealKey!: Phaser.Input.Keyboard.Key;
  private carry = { depth: 0, hp: PLAYER_MAX_HP, bound: 0, maxHp: PLAYER_MAX_HP };

  constructor() {
    super("dungeon");
  }

  // Descending carries hp/depth/bound/maxHp between floors; a fresh run (from
  // the game-over retry) passes nothing and resets. Relics + their streak/
  // fluency substrate live on the run singleton and persist across descents,
  // reset only when carry.depth is 0 (a fresh run).
  init(data?: { depth?: number; hp?: number; bound?: number; maxHp?: number }) {
    this.carry = {
      depth: data?.depth ?? 0,
      hp: data?.hp ?? PLAYER_MAX_HP,
      bound: data?.bound ?? 0,
      maxHp: data?.maxHp ?? PLAYER_MAX_HP,
    };
  }

  create() {
    // Seed once per run; each floor derives deterministically from seed + depth,
    // so a run is reproducible from its displayed seed (also written to the URL).
    if (this.carry.depth === 0) run.seed = nextRunSeed();
    const rng = new Phaser.Math.RandomDataGenerator([run.seed, String(this.carry.depth)]);
    run.floor = generateFloor(GRID_COLS, GRID_ROWS, TARGET_ROOMS, rng);
    run.visited = new Set();
    run.cleared = new Set();
    run.current = null;
    run.maxHp = this.carry.maxHp;
    run.hp = this.carry.hp;
    run.depth = this.carry.depth;
    run.bound = this.carry.bound;
    // Relics persist across descent; wipe them only on a fresh run (depth 0).
    if (this.carry.depth === 0) {
      run.relics = new Set();
      run.streak = 0;
      run.ward = false;
      run.redeemed = 0;
      run.fluency = 0;
      run.kindling = new Set();
      run.lastVerb = null;
      run.reprisal = false;
      run.kotodama = 0;
      run.reads = 0;
      run.hits = 0;
      run.readLog.clear();
      resetRun(); // clear the reviewed-this-run set for a fresh run
      this.introduced = new Set(); // re-teach the field guide on a fresh run
    }
    // Oracle's Tokens refills its reveal charges each floor.
    run.reveals = run.relics.has("oracles-tokens") ? 3 : 0;
    // Second Wind's cheat-death charge refreshes each floor.
    run.secondWind = run.relics.has("second-wind");
    // Warded Descent banks a fresh Ward at the top of each floor.
    if (run.relics.has("warded-descent")) run.ward = true;
    // Phaser reuses the scene instance across restart — reset all combat flags.
    this.dead = false;
    this.combatActive = false;
    this.transitioning = false;
    this.ordealNeeds = null;
    this.ordealTimed = false;
    this.needDeadline = 0;
    this.bossStudyDescend = null;
    this.knockbackUntil = 0;
    this.invulnUntil = 0;
    this.focusing = false;
    this.forgePlan = [];
    this.forgeStage = 0;
    this.forgeChoices = [];
    this.primePrev = false;
    this.focusConsumed = false;
    this.joyId = null;
    this.readId = null;
    resetTouch();
    this.paused = false;
    this.hazards = [];
    this.nextHazardAt = 0;
    this.blessed = new Set();
    this.shopped = new Set();
    this.focusTarget = null;
    this.srs = load();
    this.assignContent(rng);

    this.cameras.main.setBackgroundColor(BG);
    this.buildFloor();
    this.doors = this.physics.add.staticGroup();
    this.spirits = this.physics.add.group();

    for (const room of run.floor.rooms.values()) {
      // Treasure rooms now resolve to combat OR learning on arrival, so don't
      // pre-clear them; only the structural non-combat rooms are clear from the start.
      if (!LOCKS(room) && room.type !== "treasure") run.cleared.add(key(room.gx, room.gy));
    }

    const start = run.floor.start;
    this.player = this.physics.add.sprite(
      start.gx * ROOM_PX_W + ROOM_PX_W / 2,
      start.gy * ROOM_PX_H + ROOM_PX_H / 2,
      Graphics.player.key,
    );
    this.player.setSize(14, 14).setOffset(17, 30);
    this.player.anims.play(Graphics.player.animations.idle.key);
    this.applyAtmosphere();

    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.player, this.doors);
    this.physics.add.overlap(this.player, this.spirits, this.onSpiritTouch, undefined, this);
    // Keep spirits from stacking — critical so an ordeal's needed glyph is always
    // reachable/targetable (no perfect-overlap soft-lock).
    this.physics.add.collider(this.spirits, this.spirits);

    this.fitCamera();
    run.current = start;
    run.visited.add(key(start.gx, start.gy));
    this.centerOn(start, false);
    this.game.events.emit("roomChanged");
    this.game.events.emit("hpChanged");
    this.game.events.emit("lockState", false);
    this.game.events.emit("ordealEnd");

    const kb = this.input.keyboard!;
    this.keys = {
      up: kb.addKey("W"),
      down: kb.addKey("S"),
      left: kb.addKey("A"),
      right: kb.addKey("D"),
    };
    this.focusKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.cycleKey = kb.addKey("Q"); // switch the locked spirit while a read is open
    this.revealKey = kb.addKey("R");
    this.input.mouse?.disableContextMenu();
    this.isTouch = this.sys.game.device.input.touch;
    this.input.addPointer(2); // allow up to 3 concurrent pointers (2 thumbs + mouse)
    this.setupTouchInput();
    kb.addCapture("TAB"); // stop TAB from moving browser focus off the canvas
    kb.on("keydown-TAB", this.togglePause, this);
    kb.on("keydown-ESC", () => this.paused && this.togglePause(), this);
    kb.on("keydown-M", () => this.game.events.emit("muteChanged", sfx.toggleMute()), this);
    kb.on("keydown-H", this.toggleDifficulty, this);
    this.game.events.emit("muteChanged", sfx.isMuted());
    this.game.events.emit("difficultyChanged", settings.difficulty);
    this.game.events.emit("relicsChanged");

    this.game.events.on("relicChosen", this.onRelicChosen, this);
    this.game.events.on("shopDone", this.onShopDone, this);
    this.game.events.on("studyDone", this.onStudyDone, this);
    // On-screen touch controls emit these; each target guards its own preconditions.
    this.game.events.on("uiPause", this.togglePause, this);
    this.game.events.on("uiCycle", this.cycleTarget, this);
    this.game.events.on("uiDifficulty", this.toggleDifficulty, this);
    this.game.events.on("uiHeal", this.tryReveal, this);
    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => {
      this.game.events.off("relicChosen", this.onRelicChosen, this);
      this.game.events.off("shopDone", this.onShopDone, this);
      this.game.events.off("studyDone", this.onStudyDone, this);
      this.game.events.off("uiPause", this.togglePause, this);
      this.game.events.off("uiCycle", this.cycleTarget, this);
      this.game.events.off("uiDifficulty", this.toggleDifficulty, this);
      this.game.events.off("uiHeal", this.tryReveal, this);
      this.scale.off("resize", this.onResize, this);
    });
  }

  private buildFloor() {
    this.walls = this.physics.add.staticGroup();
    const env = Graphics.environment;
    for (const room of run.floor!.rooms.values()) {
      const ox = room.gx * ROOM_W;
      const oy = room.gy * ROOM_H;
      for (let y = 0; y < ROOM_H; y++) {
        for (let x = 0; x < ROOM_W; x++) {
          const wx = (ox + x) * TILE;
          const wy = (oy + y) * TILE;
          if (this.isWall(x, y, room)) {
            this.walls
              .create(wx + TILE / 2, wy + TILE / 2, env.key, env.indices.wall)
              .setTint(ATMOSPHERE.wallGrade);
          } else {
            const special = FLOOR_TINT[room.type];
            // Multiply the special-room hue (if any) into the violet grade so every
            // floor reads violet while boss/shrine/etc. still shift subtly.
            const tint =
              special == null ? ATMOSPHERE.floorGrade : mulHex(special, ATMOSPHERE.floorGrade);
            this.add
              .image(wx, wy, env.key, env.indices.floor)
              .setOrigin(0, 0)
              .setDepth(-10)
              .setTint(tint);
          }
        }
      }
    }
  }

  // The purple-haze look: grade + vignette + bloom on the dungeon camera (the HUD
  // is a separate scene, so it stays crisp), plus additive violet fog and a soft
  // light pool under the hero. Re-applied on every create() (scene restart).
  private applyAtmosphere() {
    const A = ATMOSPHERE;
    const cam = this.cameras.main;
    cam.postFX.clear();
    const cm = cam.postFX.addColorMatrix();
    cm.saturate(A.saturate);
    cm.brightness(A.brightness);
    cam.postFX.addVignette(0.5, 0.5, A.vignette.radius, A.vignette.strength);
    cam.postFX.addBloom(0xffffff, 1, 1, A.bloom.blur, A.bloom.strength);

    this.haze = this.add
      .image(0, 0, "aura")
      .setTint(A.haze.color)
      .setAlpha(A.haze.alpha)
      .setScale(A.haze.scale)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-2);
    this.playerLight = this.add
      .image(this.player.x, this.player.y, "aura")
      .setTint(A.playerLight.color)
      .setAlpha(A.playerLight.alpha)
      .setScale(A.playerLight.scale)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-1);
  }

  private isWall(x: number, y: number, room: Room): boolean {
    const border = x === 0 || y === 0 || x === ROOM_W - 1 || y === ROOM_H - 1;
    if (!border) return false;
    const inCol = Math.abs(x - CCOL) <= DOOR_HALF;
    const inRow = Math.abs(y - CROW) <= DOOR_HALF;
    if (y === 0 && room.doors.has("N") && inCol) return false;
    if (y === ROOM_H - 1 && room.doors.has("S") && inCol) return false;
    if (x === 0 && room.doors.has("W") && inRow) return false;
    if (x === ROOM_W - 1 && room.doors.has("E") && inRow) return false;
    return true;
  }

  private fitCamera() {
    const zoom = Math.min(this.scale.width / ROOM_PX_W, this.scale.height / ROOM_PX_H) * 0.96;
    this.cameras.main.setZoom(zoom);
  }

  private onResize() {
    this.fitCamera();
    if (run.current) this.centerOn(run.current, false);
  }

  private centerOn(room: Room, animate: boolean) {
    const cx = room.gx * ROOM_PX_W + ROOM_PX_W / 2;
    const cy = room.gy * ROOM_PX_H + ROOM_PX_H / 2;
    if (animate) this.cameras.main.pan(cx, cy, 240, "Sine.easeInOut");
    else this.cameras.main.centerOn(cx, cy);
  }

  private startTransition(next: Room) {
    const prev = run.current!;
    const dir: Dir =
      next.gx > prev.gx ? "E" : next.gx < prev.gx ? "W" : next.gy > prev.gy ? "S" : "N";

    this.transitioning = true;
    this.clearHazards();
    // Defensive: never carry an open read across a room change.
    if (this.focusing) {
      this.focusing = false;
      this.focusTarget?.setTargeted(false);
      this.focusTarget = null;
      touch.reading = false;
      this.readId = null;
      this.game.events.emit("focusEnd");
    }
    (this.player.body as Phaser.Physics.Arcade.Body).enable = false;
    this.player.setVelocity(0, 0);

    run.current = next;
    run.visited.add(key(next.gx, next.gy));
    this.game.events.emit("roomChanged");

    const land = this.landingSpot(next, dir);
    this.tweens.add({
      targets: this.player,
      x: land.x,
      y: land.y,
      duration: 190,
      ease: "Sine.easeOut",
    });
    this.centerOn(next, true);
    this.cameras.main.once("camerapancomplete", () => this.onArrive(next));
  }

  // Fill the floor from the SRS queue: combat rooms get review-priority kanji,
  // one treasure room becomes a study alcove for a fresh kanji, and each room's
  // dominant card state is snapshotted for the minimap.
  private assignContent(rng: Phaser.Math.RandomDataGenerator) {
    run.content = new Map();
    run.study = new Set();
    run.resolved = new Set();
    run.roomState = new Map();
    run.ordealPlan = new Map();
    run.ordeal = new Map();
    run.elite = new Set();
    run.gauntlet = new Set();
    // Normal/treasure rooms resolve their role (combat vs learning) + content
    // reactively from the live SRS queue on arrival (resolveRoom). Only the
    // special encounters — boss, elite, gauntlet — get their confusable-cluster
    // content pinned up front here.
    this.assignOrdeals(rng);
  }

  // Decide a room's role from LIVE SRS state the first time it's entered, then
  // remember it (run.resolved) so it never flips. Dispatches: planned ordeals
  // (boss/elite) and gauntlets resolve their content from LEARNED kanji here too,
  // so nothing — not even a boss — ever tests a kanji you haven't been taught.
  private resolveRoom(room: Room) {
    const k = key(room.gx, room.gy);
    if (run.resolved.has(k)) return;
    if (room.type !== "normal" && room.type !== "treasure" && room.type !== "boss") return; // start/shop/shrine keep their role
    run.resolved.add(k);
    const plan = run.ordealPlan.get(k);
    if (plan) return this.resolveOrdeal(room, plan);
    if (run.gauntlet.has(k)) return this.resolveGauntlet(room);
    this.resolveAsPlain(room, false);
  }

  // Plain room: combat from the live review queue if any's ready; else a learning
  // alcove; else empty. `mustFight` (the boss) can't go empty or become a plain
  // alcove — it must stay a clearable fight, or a naming rite that descends.
  private resolveAsPlain(room: Room, mustFight: boolean) {
    const k = key(room.gx, room.gy);
    const rng = new Phaser.Math.RandomDataGenerator([run.seed, k, "resolve"]);
    const ready = reviewReady(this.srs, rng);
    if (ready.length >= COMBAT_MIN) {
      // Measured buildup: 2 spirits on the first floor, +1 per floor, capped — a
      // predictable crescendo with depth instead of random room-to-room swings.
      // Hard mode lifts the cap for a denser crowd deeper in.
      const cap = settings.difficulty === "hard" ? MAX_EXTRA_SPIRITS + 2 : MAX_EXTRA_SPIRITS;
      const n = 2 + Math.min(run.depth, cap);
      const list = ready.slice(0, n);
      run.content.set(k, list);
      run.roomState.set(k, this.dominantState(list));
      return;
    }
    if (mustFight) {
      // Boss with an empty review queue: fall back to any learned kanji (known
      // filler) so the descent gate is still a fight.
      const learned = combatOrder(this.srs, rng);
      if (learned.length > 0) {
        const list = learned.slice(0, 3 + Math.min(run.depth, MAX_EXTRA_SPIRITS));
        run.content.set(k, list);
        run.roomState.set(k, this.dominantState(list));
        return;
      }
      // Nothing learned at all — the boss becomes a naming rite; studying it
      // descends the floor (onStudyDone). If the corpus is empty, just descend.
      const fresh = freshOnes(this.srs, rng);
      if (fresh.length === 0) {
        this.time.delayedCall(0, () => this.offerRelic(true));
        return;
      }
      run.content.set(k, [fresh[0]]);
      run.study.add(k);
      run.roomState.set(k, "new");
      this.bossStudyDescend = k;
      return;
    }
    const fresh = freshOnes(this.srs, rng);
    if (fresh.length > 0) {
      run.content.set(k, [fresh[0]]);
      run.study.add(k);
      run.roomState.set(k, "new");
      return;
    }
    run.cleared.add(k); // nothing due and nothing new — walk through
  }

  // A planned ordeal (boss/elite): build the exact-keyword encounter from the
  // cluster's LEARNED members only. Fewer than two learned confusables → there's
  // no fair ordeal to run, so downgrade to a plain fight (elite loses its relic).
  private resolveOrdeal(
    room: Room,
    plan: { cluster: string; timed: boolean; phasing: boolean; elite: boolean },
  ) {
    const k = key(room.gx, room.gy);
    const rng = new Phaser.Math.RandomDataGenerator([run.seed, k, "ordeal"]);
    const learned = (CLUSTERS[plan.cluster] ?? []).filter(
      (e) => stateOf(this.srs, e.kanji) !== "new",
    );
    if (learned.length >= 2) {
      const entries = rng.shuffle(learned.slice()).slice(0, plan.timed ? 4 : 3);
      run.content.set(k, entries);
      run.roomState.set(k, this.dominantState(entries));
      run.ordeal.set(k, {
        needs: rng.shuffle(entries.map((e) => e.keyword)),
        timed: plan.timed,
        phasing: plan.phasing,
      });
      return;
    }
    if (plan.elite) run.elite.delete(k); // no ordeal → no elite relic
    this.resolveAsPlain(room, room.type === "boss");
  }

  // A gauntlet: a dense swarm you survive for a full heal, drawn from LEARNED
  // kanji. Nothing learned yet → drop the gauntlet and resolve the room plainly.
  private resolveGauntlet(room: Room) {
    const k = key(room.gx, room.gy);
    const rng = new Phaser.Math.RandomDataGenerator([run.seed, k, "gauntlet"]);
    const pool = combatOrder(this.srs, rng);
    if (pool.length === 0) {
      run.gauntlet.delete(k);
      this.resolveAsPlain(room, false);
      return;
    }
    const list: KanjiEntry[] = [];
    const n = 3 + Math.min(run.depth, 3) + Math.min(run.depth, MAX_EXTRA_SPIRITS);
    for (let i = 0; i < n; i++) list.push(pool[i % pool.length]);
    run.content.set(k, list);
    run.roomState.set(k, this.dominantState(list));
  }

  // Turn the boss room and one normal room (elite) into precise "read the exact
  // keyword" encounters, each built on a confusable cluster. The boss alternates
  // by depth between a timed danger-patch ordeal and an untimed phasing ordeal
  // where the twins fade in and out (only readable while surfaced).
  private assignOrdeals(rng: Phaser.Math.RandomDataGenerator) {
    const clusters = pickClusters(rng, 2);
    const rooms = [...run.floor!.rooms.values()];
    const bossRoom = rooms.find((r) => r.type === "boss");
    const normalRooms = rng.shuffle(rooms.filter((r) => r.type === "normal"));
    // Only PLAN which rooms are ordeals + which cluster/timing they'll use — the
    // actual content resolves from LEARNED cluster members on arrival (resolveOrdeal).
    const phasingBoss = run.depth % 2 === 1;
    if (bossRoom && clusters[0]) {
      run.ordealPlan.set(key(bossRoom.gx, bossRoom.gy), {
        cluster: clusters[0].name,
        timed: !phasingBoss,
        phasing: phasingBoss,
        elite: false,
      });
    }
    if (normalRooms[0] && clusters[1]) {
      const k = key(normalRooms[0].gx, normalRooms[0].gy);
      run.ordealPlan.set(k, {
        cluster: clusters[1].name,
        timed: false,
        phasing: false,
        elite: true,
      });
      run.elite.add(k);
    }
    // A Gauntlet: one other normal room becomes a dense swarm you survive for a
    // full heal. Tagged now; filled from learned kanji on arrival (resolveGauntlet).
    const gauntlet = normalRooms.find((r) => !run.elite.has(key(r.gx, r.gy)));
    if (gauntlet) run.gauntlet.add(key(gauntlet.gx, gauntlet.gy));
  }

  // The boss's per-need countdown tightens one second per floor descended.
  private ordealSeconds(): number {
    // Keen Eye grants every elite/boss need a calmer +2s.
    const keen = run.relics.has("keen-eye") ? 2 : 0;
    return Math.max(ORDEAL_SECONDS_MIN, ORDEAL_SECONDS - run.depth) + keen;
  }

  private dominantState(list: KanjiEntry[]): SrsState {
    const counts: Record<SrsState, number> = { new: 0, learning: 0, due: 0, lapsed: 0, known: 0 };
    for (const e of list) counts[stateOf(this.srs, e.kanji)] += 1;
    const order: SrsState[] = ["lapsed", "learning", "due", "new", "known"];
    return order.reduce((best, st) => (counts[st] > counts[best] ? st : best), order[0]);
  }

  private onArrive(room: Room) {
    (this.player.body as Phaser.Physics.Arcade.Body).enable = true;
    this.transitioning = false;
    this.firstReadUsed = false;
    this.firstBindUsed = false;
    const k = key(room.gx, room.gy);
    this.ordealNeeds = null;
    this.game.events.emit("ordealEnd");
    // Decide this room's role from the LIVE review queue on first entry (may set
    // run.study / run.content / run.cleared), then act on that decision below.
    this.resolveRoom(room);
    if (run.study.has(k)) {
      this.enterStudy(room);
      return;
    }
    if (room.type === "shrine" && !this.blessed.has(k)) {
      this.blessed.add(k);
      const before = run.hp;
      run.hp = Math.min(run.maxHp, run.hp + 2);
      run.ward = true; // a protective Ward, even without Tally Cord
      if (run.hp !== before) this.game.events.emit("hpChanged");
      this.game.events.emit("relicsChanged");
      this.game.events.emit("shrineBless");
      sfx.relic();
      this.game.events.emit("lockState", false);
      return;
    }
    if (room.type === "shop" && !this.shopped.has(k)) {
      this.shopped.add(k);
      this.openShop();
      return;
    }
    // Combat is content-driven now: any room holding spirits (resolved combat,
    // boss/elite/gauntlet ordeals) locks; empty/cleared rooms let you walk out.
    if ((run.content.get(k)?.length ?? 0) > 0 && !run.cleared.has(k)) {
      this.lockRoom(room);
      this.spawnSpirits(room);
      this.combatActive = true;
      this.invulnUntil = this.time.now + 600;
      const ordeal = run.ordeal.get(k);
      if (ordeal) this.startOrdeal(ordeal);
      this.game.events.emit("lockState", true);
      if (run.gauntlet.has(k)) this.game.events.emit("gauntletStart");
    } else {
      this.game.events.emit("lockState", false);
    }
  }

  private startOrdeal(ordeal: { needs: string[]; timed: boolean; phasing?: boolean }) {
    this.ordealNeeds = [...ordeal.needs];
    this.ordealTimed = ordeal.timed;
    this.ordealTotal = ordeal.needs.length;
    this.needDeadline = ordeal.timed ? this.time.now + this.ordealSeconds() * 1000 : 0;
    this.ordealForgiven = false;
    this.nextHazardAt = ordeal.timed ? this.time.now + HAZARD_INTERVAL : 0;
    if (ordeal.phasing) this.game.events.emit("bossPhasing");
    this.emitOrdealNeed();
  }

  private emitOrdealNeed() {
    if (!this.ordealNeeds || this.ordealNeeds.length === 0) {
      this.game.events.emit("ordealEnd");
      return;
    }
    // Drive the HUD bar off the live deadline so any Twin-Ward +2s bonus baked
    // into needDeadline is reflected, not the base ordealSeconds().
    const seconds = this.ordealTimed
      ? Math.max(0, (this.needDeadline - this.time.now) / 1000)
      : this.ordealSeconds();
    this.game.events.emit("ordealNeed", {
      keyword: this.ordealNeeds[0],
      remaining: this.ordealNeeds.length,
      total: this.ordealTotal,
      timed: this.ordealTimed,
      boss: run.current?.type === "boss",
      seconds,
    });
  }

  // A study alcove: introduce a fresh kanji (mnemonic shown), graduate it into
  // the due queue, and grant a small heal. Non-combat, walk out freely.
  private enterStudy(room: Room) {
    const k = key(room.gx, room.gy);
    const entry = run.content.get(k)?.[0];
    run.study.delete(k);
    // Clear the alcove so re-entering never spawns combat on the just-taught kanji.
    run.cleared.add(k);
    this.game.events.emit("lockState", false);
    if (!entry) return;
    markSeen(this.srs, entry.kanji);
    // Persist the introduction to the host's real SRS (new→learning); the bridge
    // maps kanji→token and the host ignores it in practice mode.
    this.game.events.emit("taught", { kanji: entry.kanji });
    // Ember Tithe: study heals extra and banks this glyph as kindling — binding it
    // later in the wild grants a max heart.
    const heal = run.relics.has("ember-tithe") ? 2 : 1;
    if (run.relics.has("ember-tithe")) run.kindling.add(entry.kanji);
    if (run.hp < run.maxHp) {
      run.hp = Math.min(run.maxHp, run.hp + heal);
      this.game.events.emit("hpChanged");
    }
    this.combatActive = false;
    (this.player.body as Phaser.Physics.Arcade.Body)?.setVelocity(0, 0);
    this.scene.pause();
    this.scene.launch("study", {
      kanji: entry.kanji,
      keyword: entry.keyword,
      primitives: entry.primitives,
      story: entry.story,
    });
    this.scene.bringToTop("study");
  }

  private spawnSpirits(room: Room) {
    this.spirits.clear(true, true);
    const ox = room.gx * ROOM_PX_W;
    const oy = room.gy * ROOM_PX_H;
    const boss = room.type === "boss";
    const k = key(room.gx, room.gy);
    const isOrdeal = run.ordeal.has(k);
    const phasingOrdeal = run.ordeal.get(k)?.phasing ?? false;
    const list = run.content.get(k) ?? [];
    const rng = new Phaser.Math.RandomDataGenerator([run.seed, k, "pos"]);
    const used = new Set<string>();
    // Some ordinary rooms crown one spirit a Warden: shields the rest until it's
    // bound, so it becomes the priority target.
    const wardenAt =
      !isOrdeal && !boss && list.length >= 2 && rng.frac() < 0.3
        ? rng.between(0, list.length - 1)
        : -1;
    // A Shade phases in and out — only bindable while phased in (a timing read).
    const shadeAt =
      !isOrdeal && !boss && list.length >= 2 && wardenAt === -1 && rng.frac() < 0.25
        ? rng.between(0, list.length - 1)
        : -1;
    list.forEach((entry, idx) => {
      let tx = 0;
      let ty = 0;
      for (let tries = 0; tries < 40; tries++) {
        tx = rng.between(3, ROOM_INNER_W - 2);
        ty = rng.between(3, ROOM_INNER_H - 2);
        if (!used.has(`${tx},${ty}`)) break;
      }
      used.add(`${tx},${ty}`);
      const warden = idx === wardenAt;
      const shade = idx === shadeAt || (isOrdeal && phasingOrdeal);
      const scale = boss ? 1.6 : isOrdeal ? 1.2 : warden ? 1.3 : 1;
      // Ordeal/boss spirits always chase so the needed glyph stays reachable;
      // ordinary rooms get a mix for texture. Wardens chase (priority target).
      const behavior =
        isOrdeal || warden ? "chase" : BEHAVIORS[rng.between(0, BEHAVIORS.length - 1)];
      this.spirits.add(
        new Spirit(
          this,
          ox + (tx + 0.5) * TILE,
          oy + (ty + 0.5) * TILE,
          entry,
          scale,
          isOrdeal,
          behavior,
          false,
          warden,
          shade,
        ),
      );
    });
    // A Wisp sometimes haunts an ordinary combat room: a shy bonus-spirit you
    // chase down and read for a heart. It doesn't block clearing the room.
    if (!boss && !isOrdeal && list.length > 0 && rng.frac() < 0.4) {
      let wx = 0;
      let wy = 0;
      for (let tries = 0; tries < 40; tries++) {
        wx = rng.between(3, ROOM_INNER_W - 2);
        wy = rng.between(3, ROOM_INNER_H - 2);
        if (!used.has(`${wx},${wy}`)) break;
      }
      const pool = combatOrder(this.srs, rng);
      const wentry = pool[rng.between(0, Math.min(pool.length, 40) - 1)];
      // Bonus spirits draw only from learned kanji — skip if none are learned yet.
      if (wentry)
        this.spirits.add(
          new Spirit(
            this,
            ox + (wx + 0.5) * TILE,
            oy + (wy + 0.5) * TILE,
            wentry,
            0.7,
            false,
            "skittish",
            true,
          ),
        );
    }
    // A Magpie sometimes flits through a combat room: it flees, snatches kotodama
    // on contact, and is bound for a bounty (its haul back, plus a little). Like a
    // Wisp it's optional — it doesn't block clearing the room.
    if (!boss && !isOrdeal && list.length > 0 && rng.frac() < 0.25) {
      let mx = 0;
      let my = 0;
      for (let tries = 0; tries < 40; tries++) {
        mx = rng.between(3, ROOM_INNER_W - 2);
        my = rng.between(3, ROOM_INNER_H - 2);
        if (!used.has(`${mx},${my}`)) break;
      }
      const pool = combatOrder(this.srs, rng);
      const mentry = pool[rng.between(0, Math.min(pool.length, 40) - 1)];
      // Bonus spirits draw only from learned kanji — skip if none are learned yet.
      if (mentry)
        this.spirits.add(
          new Spirit(
            this,
            ox + (mx + 0.5) * TILE,
            oy + (my + 0.5) * TILE,
            mentry,
            0.8,
            false,
            "skittish",
            false,
            false,
            false,
            true,
          ),
        );
    }
    // First time each unusual spirit appears, a one-line field-guide hint so a
    // newcomer knows how to deal with it (the others announce themselves).
    this.meetKind(
      "wisp",
      this.aliveSpirits().some((s) => s.wisp),
    );
    this.meetKind(
      "shade",
      this.aliveSpirits().some((s) => s.shade),
    );
    this.meetKind(
      "thief",
      this.aliveSpirits().some((s) => s.thief),
    );
  }

  private meetKind(kind: string, present: boolean) {
    if (!present || this.introduced.has(kind)) return;
    this.introduced.add(kind);
    this.game.events.emit("meetKind", kind);
  }

  private lockRoom(room: Room) {
    this.doors.clear(true, true);
    const env = Graphics.environment;
    for (const { tx, ty } of this.openingTiles(room)) {
      this.doors
        .create(tx * TILE + TILE / 2, ty * TILE + TILE / 2, env.key, env.indices.wall)
        .setTint(ATMOSPHERE.wallGrade);
    }
  }

  private clearRoom() {
    const room = run.current;
    if (!room) return;
    const k = key(room.gx, room.gy);
    run.cleared.add(k);
    this.combatActive = false;
    this.ordealNeeds = null;
    this.clearHazards();
    for (const s of this.aliveSpirits()) if (s.wisp || s.thief) s.destroy(); // uncaught flit away
    this.doors.clear(true, true);
    sfx.roomClear();
    this.game.events.emit("ordealEnd");
    this.game.events.emit("lockState", false);
    this.game.events.emit("roomChanged");
    // Surviving a Gauntlet's swarm heals you to full.
    if (run.gauntlet.has(k)) {
      if (run.hp < run.maxHp) {
        run.hp = run.maxHp;
        this.game.events.emit("hpChanged");
      }
      sfx.relic();
      this.game.events.emit("gauntletClear");
    }
    const boss = room.type === "boss";
    // Elite and boss clears grant a relic; the boss descends after the pick.
    if (boss || run.elite.has(k)) this.offerRelic(boss);
  }

  private offerRelic(thenDescend: boolean) {
    const pool = RELIC_IDS.filter((id) => !run.relics.has(id));
    if (!pool.length) {
      if (thenDescend) this.descend();
      return;
    }
    const rng = new Phaser.Math.RandomDataGenerator([run.seed, "relic", String(run.bound)]);
    const choices = rng.shuffle(pool.slice()).slice(0, Math.min(3, pool.length));
    this.scene.pause();
    this.scene.launch("relic", { choices, thenDescend });
    this.scene.bringToTop("relic");
  }

  // Shop rooms: pause the dungeon and open the pedlar's stall. Offer one unowned
  // relic (if any remain) plus a heal and a max-heart, priced in kotodama.
  private openShop() {
    const pool = RELIC_IDS.filter((id) => !run.relics.has(id));
    const rng = new Phaser.Math.RandomDataGenerator([run.seed, "shop", String(run.depth)]);
    const relic = pool.length ? rng.shuffle(pool.slice())[0] : null;
    this.combatActive = false;
    (this.player.body as Phaser.Physics.Arcade.Body)?.setVelocity(0, 0);
    this.scene.pause();
    this.scene.launch("shop", { relic });
    this.scene.bringToTop("shop");
  }

  private onShopDone() {
    this.game.events.emit("lockState", false);
  }

  // Studying an all-new boss (a naming rite) descends the floor. Deferred a tick
  // so it runs AFTER StudyScene.close() has resumed+stopped the study scene —
  // otherwise offerRelic's pause would be clobbered by that resume.
  private onStudyDone() {
    if (!this.bossStudyDescend || !run.current) return;
    if (key(run.current.gx, run.current.gy) !== this.bossStudyDescend) return;
    this.bossStudyDescend = null;
    this.time.delayedCall(0, () => this.offerRelic(true));
  }

  private onRelicChosen(data: { id: RelicId; thenDescend: boolean }) {
    if (data.id === "oracles-tokens") run.reveals = 3; // grant charges this floor immediately
    if (data.id === "bulwark") {
      run.maxHp += 2;
      run.hp += 2;
      this.game.events.emit("hpChanged");
    }
    if (data.id === "warded-descent") run.ward = true; // bank one right away too
    if (data.thenDescend) this.descend();
  }

  // Boss down → the floor is complete. Carry hp/depth/bound into a deeper floor.
  private descend() {
    this.combatActive = false;
    (this.player.body as Phaser.Physics.Arcade.Body).enable = false;
    this.player.setVelocity(0, 0);
    if (run.relics.has("descent-draught")) {
      run.hp = Math.min(run.maxHp, run.hp + 2);
      this.game.events.emit("hpChanged");
    }
    if (run.relics.has("deep-breath")) {
      run.maxHp += 1;
      run.hp = run.maxHp; // a fuller breath: heal to full and grow
      this.game.events.emit("hpChanged");
    }
    this.game.events.emit("floorClear", run.depth + 1);
    this.time.delayedCall(1600, () => {
      if (this.dead) return;
      this.scene.restart({ depth: run.depth + 1, hp: run.hp, bound: run.bound, maxHp: run.maxHp });
    });
  }

  private openingTiles(room: Room): { tx: number; ty: number }[] {
    const ox = room.gx * ROOM_W;
    const oy = room.gy * ROOM_H;
    const tiles: { tx: number; ty: number }[] = [];
    for (const d of room.doors) {
      for (let i = -DOOR_HALF; i <= DOOR_HALF; i++) {
        if (d === "N") tiles.push({ tx: ox + CCOL + i, ty: oy });
        else if (d === "S") tiles.push({ tx: ox + CCOL + i, ty: oy + ROOM_H - 1 });
        else if (d === "W") tiles.push({ tx: ox, ty: oy + CROW + i });
        else tiles.push({ tx: ox + ROOM_W - 1, ty: oy + CROW + i });
      }
    }
    return tiles;
  }

  private landingSpot(room: Room, fromDir: Dir): { x: number; y: number } {
    const ox = room.gx * ROOM_PX_W;
    const oy = room.gy * ROOM_PX_H;
    const cx = ox + (CCOL + 0.5) * TILE;
    const cy = oy + (CROW + 0.5) * TILE;
    switch (OPPOSITE[fromDir]) {
      case "N":
        return { x: cx, y: oy + (1 + LAND_INSET) * TILE };
      case "S":
        return { x: cx, y: oy + (ROOM_H - 1 - LAND_INSET) * TILE };
      case "W":
        return { x: ox + (1 + LAND_INSET) * TILE, y: cy };
      default:
        return { x: ox + (ROOM_W - 1 - LAND_INSET) * TILE, y: cy };
    }
  }

  // — Reading combat —

  private aliveSpirits(): Spirit[] {
    return (this.spirits.getChildren() as Spirit[]).filter((s) => s.alive);
  }

  private wardenActive(): boolean {
    return this.aliveSpirits().some((s) => s.warden);
  }

  private nearestSpirit(): Spirit | null {
    let best: Spirit | null = null;
    let bestD = Infinity;
    for (const s of this.aliveSpirits()) {
      if (!s.targetable) continue; // a phased-out shade can't be read
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private wheelRadius(): number {
    return Math.min(this.scale.width, this.scale.height) * WHEEL_RADIUS_FRAC;
  }

  private startFocus(byTouch = false) {
    const target = this.nearestSpirit();
    if (!target) return;
    this.focusing = true;
    this.focusTarget = target;
    touch.reading = byTouch; // a touch read drives aim from touch.aim, not the mouse
    target.setTargeted(true);
    sfx.focus();
    this.beginForge(target);
  }

  // Switch the locked spirit mid-read (Q) — cycles by distance so you can pick a
  // specific twin in an ordeal instead of whatever's nearest. The pointer keeps
  // aiming; the read restarts on the new target from its first primitive.
  private cycleTarget() {
    if (!this.focusing || !this.focusTarget) return;
    const list = this.aliveSpirits()
      .filter((s) => s.targetable)
      .sort(
        (a, b) =>
          Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y) -
          Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y),
      );
    if (list.length < 2) return;
    const next = list[(list.indexOf(this.focusTarget) + 1) % list.length];
    if (next === this.focusTarget) return;
    this.focusTarget.setTargeted(false);
    this.focusTarget = next;
    next.setTargeted(true);
    sfx.focus();
    this.beginForge(next);
  }

  // Open the read: announce the target, build the primitive plan (showable parts
  // only), and present the first ring — or go straight to the wheel if atomic.
  private beginForge(target: Spirit) {
    this.forgePlan = target.entry.primitives.filter(hasShape);
    this.forgeStage = 0;
    // Snapshot difficulty at focus so a mid-read H-toggle can't change the option
    // count between stages of one continuous read.
    this.forgeWrong = wrongOptionCount();
    this.buildWheelWords(target);
    this.game.events.emit("focusStart", { kanji: target.entry.kanji });
    this.enterForgeStage();
  }

  // The verb wheel's word set: the correct verb wears the kanji's keyword, and
  // forgeWrong wrong verbs wear real-but-wrong keywords drawn from the deck
  // (padded with generic fallbacks if the deck is too small). Seeded per kanji so
  // the layout is stable across re-reads.
  private buildWheelWords(target: Spirit) {
    this.wheelWords.clear();
    this.wheelWords.set(target.entry.verb, target.entry.keyword);
    const rng = new Phaser.Math.RandomDataGenerator([target.entry.kanji, "wheel"]);
    const wrongVerbs = rng
      .shuffle(WHEEL_ORDER.filter((v) => v !== target.entry.verb))
      .slice(0, this.forgeWrong);
    const deckWords = rng.shuffle(
      [...new Set(CORPUS.map((e) => e.keyword))].filter((kw) => kw && kw !== target.entry.keyword),
    );
    if (deckWords.length < wrongVerbs.length) {
      const used = new Set([target.entry.keyword, ...deckWords]);
      deckWords.push(
        ...rng
          .shuffle(FALLBACK_KEYWORDS.filter((k) => !used.has(k)))
          .slice(0, wrongVerbs.length - deckWords.length),
      );
    }
    wrongVerbs.forEach((v, i) => {
      if (i < deckWords.length) this.wheelWords.set(v, deckWords[i]);
    });
  }

  // Present the current stage: a primitive recognition ring, or the verb wheel
  // once every primitive is named.
  private enterForgeStage() {
    if (this.forgeStage < this.forgePlan.length) {
      const prim = this.forgePlan[this.forgeStage];
      // Seed per primitive so the same shape always offers the same options in
      // the same order — a stable layout, not a fresh random draw each read.
      const rng = new Phaser.Math.RandomDataGenerator([prim.keyword, "forge"]);
      this.forgeChoices = buildPrimitiveChoices(prim.keyword, this.forgeWrong + 1, rng);
      const face = primitiveFace(prim);
      this.game.events.emit("forgeRing", {
        stage: this.forgeStage,
        total: this.forgePlan.length,
        faceText: face.text,
        faceRtk: face.rtk,
        choices: this.forgeChoices.map((c) => c.keyword),
        faces: this.forgePlan.map((p) => primitiveFace(p)),
        kanji: this.focusTarget?.entry.kanji ?? "",
      });
    } else {
      this.forgeChoices = [];
      this.game.events.emit("forgeWheel", {
        words: [...this.wheelWords].map(([verb, word]) => ({ verb, word })),
      });
    }
  }

  private forgeDeadzone(): number {
    return run.relics.has("steady-tongue") ? 0.18 : WHEEL_DEADZONE;
  }

  // A left-click commits the currently-aimed keyword on a primitive ring. Right
  // advances to the next ring; wrong backfires the whole read (a genuine miss).
  private commitPrimitive() {
    const target = this.focusTarget;
    if (!target || !target.alive || this.forgeStage >= this.forgePlan.length) return;
    const p = aimPoint(this);
    const idx = radialIndexAt(
      this.scale.width / 2,
      this.scale.height / 2,
      p.x,
      p.y,
      this.wheelRadius(),
      this.forgeDeadzone(),
      this.forgeChoices.length,
    );
    if (idx == null) return; // aimed at the hub — re-aim, no commit
    if (this.forgeChoices[idx].correct) {
      sfx.focus();
      this.forgeStage += 1;
      this.enterForgeStage();
      return;
    }
    const need = this.ordealNeeds?.[0];
    const onNamedGlyph = !need || target.entry.keyword === need;
    this.focusConsumed = true; // don't re-focus while the button is still held
    this.endFocus();
    this.resolveRead(target, false, onNamedGlyph, true);
  }

  // Tear down the read overlay without scoring — used on cancel and as the first
  // step of any resolution (the scoring runs after, on the captured target).
  private endFocus() {
    this.focusing = false;
    this.focusTarget?.setTargeted(false);
    this.focusTarget = null;
    this.forgePlan = [];
    this.forgeStage = 0;
    this.forgeChoices = [];
    this.wheelWords.clear();
    this.primePrev = false;
    touch.reading = false;
    this.readId = null;
    this.game.events.emit("focusEnd");
  }

  // Releasing focus resolves the read only when it's on the wheel; releasing
  // mid-forge (still naming primitives) just cancels, with no penalty.
  private releaseFocus() {
    const target = this.focusTarget;
    const onWheel = this.forgeStage >= this.forgePlan.length;
    const forged = this.forgePlan.length > 0; // this read named primitives first
    let verb = null as ReturnType<typeof wheelVerbAt>;
    let selectable = false;
    if (onWheel && target && target.alive) {
      const p = aimPoint(this);
      const deadzone = run.relics.has("steady-tongue") ? 0.18 : undefined;
      verb = wheelVerbAt(
        this.scale.width / 2,
        this.scale.height / 2,
        p.x,
        p.y,
        this.wheelRadius(),
        deadzone,
      );
      selectable = verb != null && this.wheelWords.has(verb);
    }
    this.endFocus();
    if (!target || !target.alive) return;
    if (!onWheel) return; // released mid-forge → cancel, no penalty
    // Dead-zone, or a wordless (greyed, obviously-wrong) spoke → cancel, no penalty.
    if (!verb || !selectable) return;

    // In an ordeal you must read the EXACT named keyword (right glyph AND verb),
    // not just any member of the confusable cluster.
    const need = this.ordealNeeds?.[0];
    const onNamedGlyph = !need || target.entry.keyword === need;
    const ok = onNamedGlyph && verb === target.entry.verb;
    this.resolveRead(target, ok, onNamedGlyph, forged);
  }

  // Score a committed read (wheel verb, or a wrong primitive from the forge).
  // Focus is already torn down by the caller; this only updates run/SRS state and
  // fires the bind/backfire effects.
  private resolveRead(target: Spirit, ok: boolean, onNamedGlyph: boolean, forged: boolean) {
    run.reads += 1; // a committed recall attempt (cancels never reach here)
    if (ok) run.hits += 1;

    // Capture SRS state BEFORE recording — relics reward reading rusty/known cards.
    const st = stateOf(this.srs, target.entry.kanji);
    const wasRusty = isRusty(st);
    const wasKnown = st === "known";
    // Only score the card when the read was actually about THIS glyph — targeting
    // the wrong twin in an ordeal shouldn't lapse a card you never tried to read.
    if (onNamedGlyph) recordResult(this.srs, target.entry.kanji, ok);
    // Reveal the answer after committing — teaches on a miss and, when the read
    // forged its primitives, cements the story on a hit too (forged).
    this.game.events.emit("read", {
      kanji: target.entry.kanji,
      keyword: target.entry.keyword,
      ok,
      story: target.entry.story,
      forged,
    });
    // Log the outcome per glyph so the death recap can reveal what you missed.
    // Gate on onNamedGlyph like recordResult — an off-target twin read isn't a
    // miss of a card you never tried to read.
    if (onNamedGlyph) {
      const logged = run.readLog.get(target.entry.kanji);
      if (logged) {
        if (ok) logged.hits += 1;
        else logged.misses += 1;
      } else {
        run.readLog.set(target.entry.kanji, {
          keyword: target.entry.keyword,
          story: target.entry.story,
          hits: ok ? 1 : 0,
          misses: ok ? 0 : 1,
        });
      }
    }
    if (ok) {
      const prevVerb = run.lastVerb; // before applyCorrectRead overwrites it (Echo Glyph)
      const { healed } = applyCorrectRead(run, target.entry, wasRusty, wasKnown);
      // Reprisal: the first correct read after a hit mends a heart.
      let reprisalHealed = false;
      if (run.reprisal) {
        run.reprisal = false;
        if (run.hp < run.maxHp) {
          run.hp += 1;
          reprisalHealed = true;
        }
      }
      // Warden shield: the recall counts (SRS + streak above), but the spirit
      // won't bind while a Warden still guards the room — bind the Warden first.
      if (this.wardenActive() && !target.warden && !target.wisp && !target.thief) {
        if (healed || reprisalHealed) this.game.events.emit("hpChanged");
        this.game.events.emit("shielded");
        return;
      }
      run.bound += 1;
      // each bind mints a kotodama to spend in shops; Toll Ledger adds one more.
      run.kotodama += run.relics.has("toll-ledger") ? 2 : 1;
      // Echo Glyph: chaining the same verb twice in a row mints +2 kotodama.
      if (run.relics.has("echo-glyph") && target.entry.verb === prevVerb) run.kotodama += 2;
      // Mind's Eye (First Sight): the first bind in each room mints +3 kotodama.
      if (run.relics.has("minds-eye") && !this.firstBindUsed) {
        this.firstBindUsed = true;
        run.kotodama += 3;
      }
      // A caught Wisp mends a heart — the reward for chasing it down.
      let wispHealed = false;
      if (target.wisp && run.hp < run.maxHp) {
        run.hp += 1;
        wispHealed = true;
      }
      // A caught Magpie coughs up its haul plus a small bounty; Fence's Cut
      // doubles the bounty and mends a heart.
      if (target.thief) {
        const fence = run.relics.has("fences-cut");
        run.kotodama += fence ? (target.stolen + 2) * 2 : target.stolen + 2;
        if (fence && run.hp < run.maxHp) {
          run.hp += 1;
          wispHealed = true;
        }
        this.game.events.emit("magpieCaught", target.stolen + 2);
      }
      if (healed || reprisalHealed || wispHealed) this.game.events.emit("hpChanged");
      target.bind();
      // Cascade: a hot streak binds the nearest kin of the same verb for free
      // (normal combat only — an ordeal needs each exact twin read deliberately).
      if (!this.ordealNeeds && run.relics.has("cascade-bind") && run.streak >= 5) {
        const kin = this.aliveSpirits()
          .filter((s) => s.entry.verb === target.entry.verb)
          .sort(
            (a, b) =>
              Phaser.Math.Distance.Between(target.x, target.y, a.x, a.y) -
              Phaser.Math.Distance.Between(target.x, target.y, b.x, b.y),
          )[0];
        if (kin) {
          kin.bind();
          run.bound += 1;
          run.kotodama += 1;
        }
      }
      this.game.events.emit("kotodamaChanged");
      if (this.ordealNeeds) {
        this.ordealNeeds.shift();
        this.ordealForgiven = false; // grace refreshes only on a real need advance
        if (this.ordealTimed) {
          const bonus =
            (run.relics.has("twin-ward") ? 2000 : 0) + (run.relics.has("timekeeper") ? 2000 : 0);
          this.needDeadline = this.time.now + this.ordealSeconds() * 1000 + bonus;
        }
        this.emitOrdealNeed();
      }
    } else {
      target.surge();
      const res = absorbBackfire(run, !!this.ordealNeeds, {
        firstReadUsed: this.firstReadUsed,
        ordealForgiven: this.ordealForgiven,
      });
      this.firstReadUsed = res.grace.firstReadUsed;
      this.ordealForgiven = res.grace.ordealForgiven;
      if (!res.absorbed) {
        this.hurtPlayer(target.x, target.y, true);
        this.cameras.main.flash(220, 150, 20, 20); // red — a misread bites
      } else {
        sfx.ward();
        this.cameras.main.flash(160, 240, 200, 90); // gold — a relic saved you
      }
    }
  }

  private onSpiritTouch: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (_player, spirit) => {
    const s = spirit as Spirit;
    if (!s.alive) return;
    if (s.wisp) return; // wisps are harmless bonus-spirits — never deal contact damage
    if (s.thief) {
      this.magpieSteal(s);
      return; // a Magpie snatches kotodama instead of dealing damage
    }
    if (s.shade && !s.targetable) return; // a phased-out shade is intangible
    // Iron Focus: reading is a safe bubble — no contact damage while focusing.
    if (this.focusing && run.relics.has("iron-focus")) return;
    this.hurtPlayer(s.x, s.y, false);
  };

  // A Magpie touch snatches up to 3 kotodama (only if you have any), then it
  // darts away with a short cooldown so it can't drain you in one brush.
  private magpieSteal(s: Spirit) {
    if (run.relics.has("warded-purse")) return; // a warded purse can't be picked
    if (this.time.now < s.stealReadyAt || run.kotodama <= 0) return;
    const amt = Math.min(3, run.kotodama);
    run.kotodama -= amt;
    s.stolen += amt;
    s.stealReadyAt = this.time.now + 1500;
    this.game.events.emit("kotodamaChanged");
    this.game.events.emit("magpieSteal", amt);
    sfx.spiritSurge();
    const ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, s.x, s.y);
    (s.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(ang) * SPIRIT_SPEED * 3,
      Math.sin(ang) * SPIRIT_SPEED * 3,
    );
  }

  private hurtPlayer(fromX: number, fromY: number, ignoreIframe: boolean) {
    if (this.dead) return;
    if (!ignoreIframe && this.time.now < this.invulnUntil) return;
    run.hp -= 1;
    if (run.relics.has("reprisal")) run.reprisal = true; // your next correct read heals
    this.invulnUntil = this.time.now + IFRAME_MS;
    this.game.events.emit("hpChanged");
    sfx.playerHurt();
    this.cameras.main.shake(120, 0.006);

    const ang = Phaser.Math.Angle.Between(fromX, fromY, this.player.x, this.player.y);
    this.player.setVelocity(Math.cos(ang) * KNOCKBACK, Math.sin(ang) * KNOCKBACK);
    this.knockbackUntil = this.time.now + KNOCKBACK_MS;

    this.tweens.add({
      targets: this.player,
      alpha: 0.25,
      duration: 90,
      yoyo: true,
      repeat: Math.floor(IFRAME_MS / 180),
      onComplete: () => this.player.setAlpha(1),
    });
    // Second Wind: once per floor, a killing blow leaves you at one heart.
    if (run.hp <= 0 && run.secondWind) {
      run.secondWind = false;
      run.hp = 1;
      this.game.events.emit("hpChanged");
      this.game.events.emit("relicsChanged");
      sfx.ward();
      this.cameras.main.flash(260, 240, 200, 90);
      return;
    }
    if (run.hp <= 0) this.die();
  }

  private die() {
    this.dead = true;
    this.focusing = false;
    this.focusTarget = null;
    touch.reading = false;
    this.readId = null;
    this.ordealNeeds = null;
    this.clearHazards();
    this.game.events.emit("focusEnd");
    this.game.events.emit("ordealEnd");
    this.player.setVelocity(0, 0);
    // Freeze spirits too, or they keep their last chase velocity and drift
    // through the walls under the game-over overlay (update() early-returns).
    for (const s of this.aliveSpirits()) (s.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    sfx.gameOver();
    this.game.events.emit("lockState", false);
    // Single per-run end point (guarded by this.dead) — report the recall
    // summary to the host exactly once.
    this.game.events.emit("runEnd", { reads: run.reads, hits: run.hits });
    this.scene.launch("gameover", { depth: run.depth, bound: run.bound });
    this.scene.bringToTop("gameover");
  }

  // Boss pressure: each need has a countdown; hesitate and it lashes out. The
  // clock slows (but never freezes) while you're mid-read: Focus isn't a trap,
  // but holding it can't neutralize the boss's pressure either.
  private tickOrdealTimer() {
    if (!this.ordealTimed || !this.ordealNeeds || this.ordealNeeds.length === 0) return;
    if (this.focusing) {
      this.needDeadline += this.game.loop.delta * 0.5;
    }
    if (this.time.now > this.needDeadline) {
      this.needDeadline = this.time.now + this.ordealSeconds() * 1000;
      for (const s of this.aliveSpirits()) s.surge();
      this.hurtPlayer(this.player.x, this.player.y + 40, true);
      this.emitOrdealNeed();
    }
  }

  // Boss-only hazard: telegraphed danger patches you must dodge while reading.
  // Each patch shows a growing red ring for HAZARD_TELEGRAPH ms, then detonates —
  // standing in one at detonation costs a heart (iframe-respected).
  private tickHazards() {
    if (!this.ordealTimed || !this.ordealNeeds || this.ordealNeeds.length === 0) {
      if (this.hazards.length) this.clearHazards();
      return;
    }
    const now = this.time.now;
    for (const h of this.hazards) {
      if (now < h.detonateAt) {
        const t = 1 - (h.detonateAt - now) / h.telegraph;
        h.gfx.setScale(0.4 + t * 0.6).setStrokeStyle(2.5, 0xff4444, 0.35 + t * 0.55);
        continue;
      }
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, h.x, h.y) <= HAZARD_RADIUS) {
        this.hurtPlayer(h.x, h.y, false);
      }
      this.detonateFlash(h.x, h.y);
      h.gfx.destroy();
    }
    this.hazards = this.hazards.filter((h) => now < h.detonateAt);

    if (now >= this.nextHazardAt) {
      this.spawnHazardWave(now);
      this.nextHazardAt = now + HAZARD_INTERVAL;
    }
  }

  private spawnHazardWave(now: number) {
    const room = run.current;
    if (!room) return;
    const ox = room.gx * ROOM_PX_W;
    const oy = room.gy * ROOM_PX_H;
    const pad = TILE * 2 + HAZARD_RADIUS;
    const count = Math.min(HAZARD_COUNT + Math.floor(run.depth / 2), HAZARD_COUNT_MAX);
    const telegraph = run.relics.has("long-shadow") ? HAZARD_TELEGRAPH * 1.6 : HAZARD_TELEGRAPH;
    const placed: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      let x = 0;
      let y = 0;
      // Keep patches apart and off the player's feet so each is a distinct,
      // dodgeable zone rather than an overlapping blob.
      for (let tries = 0; tries < 12; tries++) {
        x = Phaser.Math.Between(ox + pad, ox + ROOM_PX_W - pad);
        y = Phaser.Math.Between(oy + pad, oy + ROOM_PX_H - pad);
        const onPlayer =
          Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < HAZARD_RADIUS * 1.6;
        const onPatch = placed.some(
          (p) => Phaser.Math.Distance.Between(x, y, p.x, p.y) < HAZARD_RADIUS * 2.2,
        );
        if (!onPlayer && !onPatch) break;
      }
      placed.push({ x, y });
      const gfx = this.add
        .circle(x, y, HAZARD_RADIUS, 0xff4444, 0.08)
        .setStrokeStyle(2.5, 0xff4444, 0.35)
        .setDepth(1);
      this.hazards.push({ gfx, x, y, detonateAt: now + telegraph, telegraph });
    }
  }

  private detonateFlash(x: number, y: number) {
    const boom = this.add.circle(x, y, HAZARD_RADIUS, 0xff6644, 0.5).setDepth(1);
    this.tweens.add({
      targets: boom,
      scale: 1.3,
      alpha: 0,
      duration: 180,
      onComplete: () => boom.destroy(),
    });
  }

  private clearHazards() {
    for (const h of this.hazards) h.gfx.destroy();
    this.hazards = [];
  }

  private clampSpirits(room: Room) {
    const ox = room.gx * ROOM_PX_W;
    const oy = room.gy * ROOM_PX_H;
    const minX = ox + TILE * 1.6;
    const maxX = ox + ROOM_PX_W - TILE * 1.6;
    const minY = oy + TILE * 1.6;
    const maxY = oy + ROOM_PX_H - TILE * 1.6;
    for (const s of this.aliveSpirits()) {
      s.x = Phaser.Math.Clamp(s.x, minX, maxX);
      s.y = Phaser.Math.Clamp(s.y, minY, maxY);
    }
  }

  // Codex/pause: freeze physics and let the HUD render the relic list. Guarded so
  // you can't pause mid-read, mid-transition, or once dead. The scene clock keeps
  // running while paused, so shift every wall-clock deadline (boss timer, iframes,
  // knockback) forward by the paused span on resume — else a pause eats the timer.
  private togglePause() {
    if (this.transitioning || this.dead || this.focusing) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.physics.pause();
      this.pausedAt = this.time.now;
    } else {
      this.physics.resume();
      const span = this.time.now - this.pausedAt;
      this.needDeadline += span;
      this.invulnUntil += span;
      this.knockbackUntil += span;
      this.nextHazardAt += span;
      for (const h of this.hazards) h.detonateAt += span;
    }
    this.game.events.emit("pauseMenu", this.paused);
  }

  private toggleDifficulty() {
    settings.difficulty = settings.difficulty === "easy" ? "hard" : "easy";
    this.game.events.emit("difficultyChanged", settings.difficulty);
  }

  // Oracle's Tokens: spend a charge mid-read to mend a heart (no-op at full HP,
  // so a charge is never wasted). Driven by the R key and the touch Heal button.
  private tryReveal() {
    if (
      this.focusing &&
      run.reveals > 0 &&
      run.hp < run.maxHp &&
      run.relics.has("oracles-tokens")
    ) {
      run.reveals -= 1;
      run.hp += 1;
      sfx.ward();
      this.game.events.emit("hpChanged");
      this.game.events.emit("relicsChanged");
    }
  }

  // Touch input: the left half of the screen is a floating move-stick, the right
  // half opens a read (phase 2). Handlers act only on touch pointers, so a mouse
  // on a touch-capable device keeps the desktop keyboard+mouse path untouched.
  private setupTouchInput() {
    this.input.on("pointerdown", this.onTouchDown, this);
    this.input.on("pointermove", this.onTouchMove, this);
    this.input.on("pointerup", this.onTouchUp, this);
    this.input.on("pointerupoutside", this.onTouchUp, this);
  }

  private onTouchDown(p: Phaser.Input.Pointer) {
    if (!p.wasTouch) return;
    // A tap on a HUD button is handled by the HUD — never let it also claim the
    // joystick or a read (the button may sit in either zone).
    for (const b of touch.buttons) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return;
    }
    // Left half → the move-stick (claimed by the first thumb there).
    if (p.x < this.scale.width / 2) {
      if (this.joyId === null) {
        this.joyId = p.id;
        touch.joyActive = true;
        touch.joyOrigin.x = p.x;
        touch.joyOrigin.y = p.y;
        touch.joyKnob.x = p.x;
        touch.joyKnob.y = p.y;
        touch.move.x = 0;
        touch.move.y = 0;
      }
      return;
    }
    // Right half → open a read, or aim the next sticky stage of one already open.
    if (!this.focusing) {
      this.startFocus(true);
      if (!this.focusing) return; // no spirit to read
    } else if (!touch.reading || this.readId !== null) {
      // A mouse read is open, or a finger already owns this read — don't let a
      // stray second touch hijack readId (which would orphan the first finger).
      return;
    }
    this.readId = p.id;
    touch.aim.x = p.x;
    touch.aim.y = p.y;
  }

  private onTouchMove(p: Phaser.Input.Pointer) {
    if (!p.wasTouch) return;
    if (p.id === this.readId) {
      touch.aim.x = p.x;
      touch.aim.y = p.y;
    }
    if (p.id === this.joyId) {
      const dx = p.x - touch.joyOrigin.x;
      const dy = p.y - touch.joyOrigin.y;
      const len = Math.hypot(dx, dy) || 1;
      const clamp = Math.min(len, JOY_RADIUS);
      touch.joyKnob.x = touch.joyOrigin.x + (dx / len) * clamp;
      touch.joyKnob.y = touch.joyOrigin.y + (dy / len) * clamp;
      // A small deadzone so a resting-thumb slip can't lurch the player at full speed.
      if (len < JOY_DEADZONE) {
        touch.move.x = 0;
        touch.move.y = 0;
      } else {
        touch.move.x = (dx / len) * (clamp / JOY_RADIUS);
        touch.move.y = (dy / len) * (clamp / JOY_RADIUS);
      }
    }
  }

  private onTouchUp(p: Phaser.Input.Pointer) {
    if (p.id === this.joyId) {
      this.joyId = null;
      touch.joyActive = false;
      touch.move.x = 0;
      touch.move.y = 0;
    }
    if (p.id === this.readId) {
      this.readId = null;
      this.commitTouchStage();
    }
  }

  // Lifting the read finger commits the current stage: name a primitive (a
  // correct pick advances and the read stays open for the next thumb-down), or
  // cast the verb on the wheel. Lifting over the hub cancels the whole read.
  private commitTouchStage() {
    if (!this.focusing) return;
    const d = Math.hypot(touch.aim.x - this.scale.width / 2, touch.aim.y - this.scale.height / 2);
    if (d < this.wheelRadius() * this.forgeDeadzone()) {
      this.endFocus();
      return;
    }
    if (this.forgeStage < this.forgePlan.length) this.commitPrimitive();
    else this.releaseFocus();
  }

  update() {
    if (this.haze) {
      const mp = this.cameras.main.midPoint;
      this.haze.setPosition(mp.x, mp.y);
    }
    if (this.playerLight) this.playerLight.setPosition(this.player.x, this.player.y);
    if (this.dead) {
      this.player.setVelocity(0, 0);
      return;
    }
    if (this.paused) {
      this.player.setVelocity(0, 0);
      return;
    }
    if (this.transitioning) {
      this.player.setVelocity(0, 0);
      return;
    }

    if (run.current) this.clampSpirits(run.current);

    // Focus is held via SPACE or right mouse button; release resolves the read.
    // A read that resolves mid-hold (a wrong primitive) latches focus off until
    // the button is released, so it can't instantly re-focus under a held button.
    // Desktop mouse+keyboard read. Skipped entirely while a touch read is open —
    // on touch, wantFocus/leftButtonDown are meaningless (a finger reads as a held
    // left button), so running these would fight the touch gesture every frame.
    if (!touch.reading) {
      const wantFocus = this.focusKey.isDown || this.input.activePointer.rightButtonDown();
      if (!wantFocus) this.focusConsumed = false;
      if (wantFocus && !this.focusing && !this.focusConsumed) this.startFocus();
      else if (!wantFocus && this.focusing) this.releaseFocus();
    }
    if (this.focusing && Phaser.Input.Keyboard.JustDown(this.cycleKey)) this.cycleTarget();
    if (!touch.reading) {
      // A left-click commits the aimed keyword on a primitive ring (edge-triggered).
      const primeDown = this.input.activePointer.leftButtonDown();
      if (
        this.focusing &&
        primeDown &&
        !this.primePrev &&
        this.forgeStage < this.forgePlan.length
      ) {
        this.commitPrimitive();
      }
      this.primePrev = primeDown;
    }

    const k = this.keys;
    let vx = 0;
    let vy = 0;
    if (k.left.isDown) vx -= 1;
    if (k.right.isDown) vx += 1;
    if (k.up.isDown) vy -= 1;
    if (k.down.isDown) vy += 1;
    vx += touch.move.x; // the virtual move-stick (zero unless a thumb drives it)
    vy += touch.move.y;

    // Fleet Tongue lets you read on the move — a boost while a read is open, so
    // you can slip a boss danger patch without dropping the read.
    const pSpeed =
      this.focusing && run.relics.has("fleet-tongue") ? PLAYER_SPEED * 1.5 : PLAYER_SPEED;
    const v = new Phaser.Math.Vector2(vx, vy);
    // Clamp to unit length (keeps diagonal/keyboard from out-running a single axis)
    // but preserve a partial virtual-stick throw so analog movement survives.
    if (v.lengthSq() > 1) v.normalize();
    v.scale(pSpeed);
    if (this.time.now >= this.knockbackUntil) this.player.setVelocity(v.x, v.y);

    const p = Graphics.player.animations;
    if (v.lengthSq() > 0) {
      if (vx !== 0) this.player.setFlipX(vx < 0);
      if (vy < 0) this.facingBack = true;
      else if (vy > 0) this.facingBack = false;
      this.player.anims.play(this.facingBack ? p.walkBack.key : p.walk.key, true);
    } else {
      this.player.anims.play(this.facingBack ? p.idleBack.key : p.idle.key, true);
    }

    // Kotodama Chorus deepens the Focus slow while a streak is hot; Patient Word
    // freezes spirits entirely, but never during a boss fight (that would defang it).
    const chorus = run.relics.has("kotodama-chorus") && run.streak >= 4;
    const frozen = run.relics.has("patient-word") && run.current?.type !== "boss";
    const slowFactor = this.focusing ? (frozen ? 0 : chorus ? FOCUS_SLOW * 0.5 : FOCUS_SLOW) : 1;
    const speed = SPIRIT_SPEED * slowFactor;
    for (const s of this.aliveSpirits()) {
      s.steer(this.player.x, this.player.y, speed, this.focusing);
    }

    // Consume the reveal-key edge unconditionally — gating JustDown behind other
    // conditions would leave a stale press to fire later. tryReveal holds the guards.
    if (Phaser.Input.Keyboard.JustDown(this.revealKey)) this.tryReveal();

    this.tickOrdealTimer();
    this.tickHazards();

    // Wisps are optional — the room clears once every threatening spirit is bound.
    if (this.combatActive && this.aliveSpirits().every((s) => s.wisp || s.thief)) this.clearRoom();

    const gx = Math.floor(this.player.x / ROOM_PX_W);
    const gy = Math.floor(this.player.y / ROOM_PX_H);
    const room = run.floor!.rooms.get(key(gx, gy));
    if (room && room !== run.current) this.startTransition(room);
  }
}
