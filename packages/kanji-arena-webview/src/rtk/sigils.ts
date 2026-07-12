import type { VerbId } from "./verbs";

// One hand-drawn sigil per semantic verb — the wheel's fixed visual identity.
// Authored in a 0..48 box as SVG sub-paths; a filled sub-path has no `w`, a
// stroked one gives its line width. BootScene rasterises these to white canvas
// textures (keyed by sigilKey) that the wheel tints per verb. `evenodd` cuts
// holes (the hide mask's eyes) from a single fill path.
export interface SigilPart {
  d: string;
  w?: number; // stroke width; omit for a filled shape
  evenodd?: boolean;
}

export const SIGIL_BOX = 48;

export const SIGILS: Record<VerbId, SigilPart[]> = {
  burn: [{ d: "M24 6C33 20 29 40 24 42 15 40 15 20 24 6Z" }],
  douse: [{ d: "M24 7C33 22 32 33 24 39 16 33 15 22 24 7Z" }, { d: "M13 40q11 6 22 0", w: 3 }],
  cut: [
    { d: "M11 37 37 11", w: 4.5 },
    { d: "M30 11l6-2-2 6", w: 3 },
  ],
  strike: [{ d: "M24 4 28 20 44 24 28 28 24 44 20 28 4 24 20 20Z" }],
  stop: [
    { d: "M17 7H31L41 17V31L31 41H17L7 31V17Z", w: 3.5 },
    { d: "M16 24H32", w: 3.5 },
  ],
  open: [
    { d: "M19 12 9 24 19 36", w: 4 },
    { d: "M29 12 39 24 29 36", w: 4 },
  ],
  block: [{ d: "M24 5 39 11V24C39 34 32 40 24 43 16 40 9 34 9 24V11Z", w: 3.5 }],
  grow: [
    { d: "M24 43V22", w: 3.5 },
    { d: "M24 28C15 27 12 18 12 18 21 17 24 24 24 28Z" },
    { d: "M24 24C33 22 36 14 36 14 27 14 24 20 24 24Z" },
  ],
  rise: [
    { d: "M12 27 24 15 36 27", w: 4 },
    { d: "M12 37 24 25 36 37", w: 4 },
  ],
  fall: [
    { d: "M12 11 24 23 36 11", w: 4 },
    { d: "M12 21 24 33 36 21", w: 4 },
  ],
  rush: [
    { d: "M9 16H39", w: 3.5 },
    { d: "M9 24H33", w: 3.5 },
    { d: "M9 32H27", w: 3.5 },
  ],
  reveal: [
    { d: "M6 24C14 13 34 13 42 24 34 35 14 35 6 24Z", w: 3.5 },
    { d: "M18.5 24a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0Z" },
  ],
  hide: [
    {
      d: "M6 17c3-3 8-3 12-1 2 1 3 2 6 2s4-1 6-2c4-2 9-2 12 1 2 6-2 13-9 13-3 0-4-2-9-2s-6 2-9 2c-7 0-11-7-9-13Z M13.5 19a3.1 4 0 1 0 6.2 0a3.1 4 0 1 0-6.2 0Z M28.3 19a3.1 4 0 1 0 6.2 0a3.1 4 0 1 0-6.2 0Z",
      evenodd: true,
    },
  ],
  heal: [{ d: "M20 8H28V20H40V28H28V40H20V28H8V20H20Z" }],
  harm: [{ d: "M27 5 13 27H22L19 43 35 19H26L29 5Z" }],
  charm: [{ d: "M24 41C4 29 10 11 21 13c2 .4 3 2 3 2s1-1.6 3-2c11-2 17 16-3 28Z" }],
};

export const sigilKey = (verb: VerbId): string => `sigil-${verb}`;
