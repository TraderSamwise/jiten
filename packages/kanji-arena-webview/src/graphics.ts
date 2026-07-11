// Asset metadata for the fongoose CC0 roguelike set (via DungeonDash, MIT).
// Tile indices assume the environment sheet is 16 columns wide, so a frame
// number is 0xRC = row*16 + col. Animation frame ranges are the fongoose sheets.
// Sheets are imported so esbuild's dataurl loader inlines them (offline-safe).
import environmentPng from "./assets/environment.png";
import playerPng from "./assets/player.png";

export const Graphics = {
  environment: {
    key: "environment",
    file: environmentPng,
    width: 16,
    height: 16,
    margin: 1,
    spacing: 2,
    indices: {
      floor: 0x05,
      block: 0x17,
      wall: 0x14,
    },
  },
  player: {
    key: "player",
    file: playerPng,
    width: 48,
    height: 48,
    animations: {
      idle: { key: "playerIdle", start: 0x01, end: 0x07, frameRate: 6, repeat: -1 },
      idleBack: { key: "playerIdleBack", start: 0x0a, end: 0x11, frameRate: 6, repeat: -1 },
      walk: { key: "playerWalk", start: 0x14, end: 0x19, frameRate: 10, repeat: -1 },
      walkBack: { key: "playerWalkBack", start: 0x1e, end: 0x23, frameRate: 10, repeat: -1 },
    },
  },
} as const;
