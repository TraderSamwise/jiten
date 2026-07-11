import { WHEEL_DEADZONE } from "../config";
import type { VerbId } from "./verbs";
import { WHEEL_ORDER } from "./verbs";

const SEG = 360 / WHEEL_ORDER.length;

// Which verb the pointer is selecting, computed from its angle around the wheel
// centre. Returns null inside the dead-zone (a release there = cancel). Segment 0
// sits at the top (12 o'clock); segments run clockwise. Both scenes call this with
// the same screen-space pointer, so they never disagree on the highlight.
export function wheelVerbAt(
  cx: number,
  cy: number,
  px: number,
  py: number,
  radius: number,
  deadzoneFrac: number = WHEEL_DEADZONE,
): VerbId | null {
  const dx = px - cx;
  const dy = py - cy;
  if (Math.hypot(dx, dy) < radius * deadzoneFrac) return null;
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
  const seg = Math.floor(deg / SEG) % WHEEL_ORDER.length;
  return WHEEL_ORDER[seg];
}

// Geometry of a segment, in Phaser arc radians (0 = east, +clockwise), for the
// HUD to draw pie slices — aligned exactly to wheelVerbAt: segment 0 begins at
// the top (12 o'clock) and runs clockwise.
export function segmentAngles(i: number): { start: number; end: number; mid: number } {
  const startDeg = i * SEG - 90;
  const r = Math.PI / 180;
  return { start: startDeg * r, end: (startDeg + SEG) * r, mid: (startDeg + SEG / 2) * r };
}
