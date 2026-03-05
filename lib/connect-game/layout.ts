import type { Bubble, BubbleKind } from "./types";

const BUBBLE_HEIGHT = 44;
const BUBBLE_PADDING = 24; // horizontal text padding
const MIN_CHAR_WIDTH = 14;
const MAX_CHAR_WIDTH = 10;

/** Minimum distance between bubble centers (pixels) */
const MIN_DISTANCE = 80;
/** Margin from field edges (normalized) */
const EDGE_MARGIN = 0.05;

/** Estimate bubble width from text content */
export function estimateBubbleWidth(text: string, kind: BubbleKind): number {
  const charWidth = kind === "meaning" ? MAX_CHAR_WIDTH : MIN_CHAR_WIDTH;
  return Math.max(60, text.length * charWidth + BUBBLE_PADDING);
}

export function getBubbleHeight(): number {
  return BUBBLE_HEIGHT;
}

/** Find a random position that doesn't overlap existing bubbles */
export function findSpawnPosition(
  existing: Bubble[],
  width: number,
  height: number,
  fieldWidth: number,
  fieldHeight: number,
  maxAttempts: number = 30,
): { x: number; y: number } {
  const halfW = (width / fieldWidth) * 0.5;
  const halfH = (height / fieldHeight) * 0.5;
  const minX = EDGE_MARGIN + halfW;
  const maxX = 1 - EDGE_MARGIN - halfW;
  const minY = EDGE_MARGIN + halfH;
  const maxY = 0.7 - halfH;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);

    const tooClose = existing.some((b) => {
      if (b.matched || b.expired) return false;
      const dx = (x - b.x) * fieldWidth;
      const dy = (y - b.y) * fieldHeight;
      return Math.sqrt(dx * dx + dy * dy) < MIN_DISTANCE;
    });

    if (!tooClose) return { x, y };
  }

  // Fallback: random position even if overlapping
  return {
    x: minX + Math.random() * (maxX - minX),
    y: minY + Math.random() * (maxY - minY),
  };
}
