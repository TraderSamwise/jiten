// Shared touch-input state, mutated by DungeonScene's pointer handlers and read
// by HudScene to render the on-screen controls. A module-level singleton (like
// `run`/`settings`) so the two scenes share one source of truth without wiring
// events per frame. All positions are SCREEN pixels (unzoomed), matching the
// HUD's coordinate space; `move` is a direction in [-1,1].
export const JOY_RADIUS = 48; // px throw of the virtual stick
export const JOY_DEADZONE = 8; // px slack before the stick registers a direction

export const touch = {
  move: { x: 0, y: 0 }, // joystick direction (screen delta / JOY_RADIUS)
  joyActive: false,
  joyOrigin: { x: 0, y: 0 }, // where the thumb first landed
  joyKnob: { x: 0, y: 0 }, // clamped current thumb position
  reading: false, // a touch-initiated read is open (the aim source)
  aim: { x: 0, y: 0 }, // the read pointer's last screen point
  buttons: [] as { x: number; y: number; w: number; h: number }[], // HUD tap-target rects to ignore
};

export function resetTouch(): void {
  touch.move.x = 0;
  touch.move.y = 0;
  touch.joyActive = false;
  touch.reading = false;
  touch.buttons = [];
}
