import { WHEEL_DEADZONE } from "../config";
import type { VerbId } from "./verbs";
import { WHEEL_ORDER } from "./verbs";

// Which of `n` evenly-spaced radial slots the pointer is selecting, from its
// angle around the centre. Returns null inside the dead-zone (a release there =
// cancel). Slot 0 sits at the top (12 o'clock); slots run clockwise. Shared by
// the verb wheel and the Forge's primitive rings so a scene's highlight and the
// committed pick never disagree.
export function radialIndexAt(
  cx: number,
  cy: number,
  px: number,
  py: number,
  radius: number,
  deadzoneFrac: number,
  n: number,
): number | null {
  const dx = px - cx;
  const dy = py - cy;
  if (Math.hypot(dx, dy) < radius * deadzoneFrac) return null;
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
  return Math.floor(deg / (360 / n)) % n;
}

// Which verb the pointer is selecting on the 16-spoke wheel; null in the dead-zone.
export function wheelVerbAt(
  cx: number,
  cy: number,
  px: number,
  py: number,
  radius: number,
  deadzoneFrac: number = WHEEL_DEADZONE,
): VerbId | null {
  const i = radialIndexAt(cx, cy, px, py, radius, deadzoneFrac, WHEEL_ORDER.length);
  return i == null ? null : WHEEL_ORDER[i];
}

// Geometry of slot `i` of `n`, in Phaser arc radians (0 = east, +clockwise), for
// the HUD to draw pie slices — aligned exactly to radialIndexAt: slot 0 begins
// at the top (12 o'clock) and runs clockwise.
export function segmentAngles(
  i: number,
  n: number = WHEEL_ORDER.length,
): { start: number; end: number; mid: number } {
  const seg = 360 / n;
  const startDeg = i * seg - 90;
  const r = Math.PI / 180;
  return { start: startDeg * r, end: (startDeg + seg) * r, mid: (startDeg + seg / 2) * r };
}

// The mid-angle (radians) of slot `i` of `n` — where a renderer places the icon
// or label for that slot.
export function slotMid(i: number, n: number): number {
  return segmentAngles(i, n).mid;
}
