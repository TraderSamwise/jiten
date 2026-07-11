// Tiny procedural SFX via WebAudio — no asset files, works in browser + webview.
// The AudioContext resumes lazily on first play (always after a key/tap gesture).
let ctx: AudioContext | null = null;

// Mute is persisted and — for now, while audio is being worked on elsewhere —
// defaults ON when no preference is stored. Toggle with M in-game.
function loadMute(): boolean {
  try {
    const v = localStorage.getItem("rtk-muted");
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}
let muted = loadMute();

function ac(): AudioContext {
  if (!ctx)
    ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(from: number, to: number, dur: number, type: OscillatorType, gain = 0.06) {
  if (muted) return;
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, to), c.currentTime + dur);
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

function noise(dur: number, gain = 0.08) {
  if (muted) return;
  const c = ac();
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(c.destination);
  src.start();
}

export const sfx = {
  hit: () => noise(0.05, 0.05),
  enemyDeath: () => tone(320, 60, 0.18, "sawtooth", 0.07),
  playerHurt: () => tone(220, 70, 0.22, "square", 0.09),
  roomClear: () => {
    tone(523, 523, 0.09, "triangle", 0.07);
    setTimeout(() => tone(784, 784, 0.13, "triangle", 0.07), 95);
  },
  gameOver: () => tone(300, 70, 0.55, "sawtooth", 0.09),
  // Entering Focus — a soft time-slowing descent.
  focus: () => tone(560, 360, 0.22, "sine", 0.05),
  // Correct read — a bright bound chord.
  bind: () => {
    tone(659, 659, 0.08, "triangle", 0.07);
    setTimeout(() => tone(988, 988, 0.16, "triangle", 0.07), 70);
  },
  // Wrong read — the spirit's meaning lashes back.
  spiritSurge: () => {
    tone(170, 80, 0.2, "sawtooth", 0.09);
    noise(0.09, 0.06);
  },
  // A relic soaks a backfire — a bright rising "shielded" chime over the lash.
  ward: () => tone(784, 1175, 0.16, "sine", 0.07),
  // Claiming a relic — a rising three-note shimmer.
  relic: () => {
    tone(587, 587, 0.1, "triangle", 0.06);
    setTimeout(() => tone(880, 880, 0.1, "triangle", 0.06), 90);
    setTimeout(() => tone(1175, 1175, 0.2, "sine", 0.06), 180);
  },
  isMuted: () => muted,
  setMuted: (m: boolean) => {
    muted = m;
    try {
      localStorage.setItem("rtk-muted", m ? "1" : "0");
    } catch {
      // ignore persistence failure
    }
  },
  toggleMute() {
    this.setMuted(!muted);
    return muted;
  },
};
