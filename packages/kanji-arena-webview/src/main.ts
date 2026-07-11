import Phaser from "phaser";
import { BG } from "./config";
import { hasHostSession, initBridge } from "./bridge";
import { CORPUS, loadStubCorpus } from "./rtk/corpus";
import BootScene from "./scenes/BootScene";
import DungeonScene from "./scenes/DungeonScene";
import GameOverScene from "./scenes/GameOverScene";
import HudScene from "./scenes/HudScene";
import RelicScene from "./scenes/RelicScene";
import ShopScene from "./scenes/ShopScene";
import StudyScene from "./scenes/StudyScene";
import TitleScene from "./scenes/TitleScene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: BG,
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [
    BootScene,
    TitleScene,
    DungeonScene,
    HudScene,
    RelicScene,
    ShopScene,
    StudyScene,
    GameOverScene,
  ],
});

// Kick off loading the embedded RTK primitive font at boot so canvas text has
// the face ready by the time a study alcove draws its primitive shapes.
if (typeof document !== "undefined" && document.fonts?.load) {
  document.fonts.load('30px "RtkPrimitives"').catch(() => {});
}

// The single coupling surface: announce readiness, receive the session, forward
// read results. The game imports nothing host-side.
initBridge(game);

// Standalone-dev fallback: if no host session ever arrives, play the stub corpus
// so the Vite build stays usable on its own. Keyed on hasHostSession(), not corpus
// size — an embedded host with an empty cohort must NOT get the demo stub (that
// would show kanji outside the user's selected list).
setTimeout(() => {
  if (!hasHostSession() && CORPUS.length === 0) {
    loadStubCorpus();
    game.events.emit("corpusReady", { count: CORPUS.length });
  }
}, 2000);
