// Asset metadata for the fongoose CC0 roguelike set (via DungeonDash, MIT).
// The environment is now drawn procedurally (see DungeonScene.buildFloor); only
// the player sheet is imported so esbuild's dataurl loader inlines it (offline-safe).
import playerPng from "./assets/player.png";

export const Graphics = {
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
