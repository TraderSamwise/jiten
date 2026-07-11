import { arenaBundle } from "../bundle";
import { rtkPrimitivesBase64 } from "./font-data";

// Assemble the fully-offline HTML document that hosts the game. The bundle (a
// JSON-stringified IIFE that includes Phaser + the game) is inlined so there is
// no network or asset dependency — safe inside a react-native-webview or iframe.
// The RTK primitive font is embedded as a data-URI @font-face so the game can
// draw invented-primitive shapes; it does not inherit the host app's fonts.
export function generateArenaHtml(): string {
  const fontFace = `@font-face{font-family:'RtkPrimitives';font-style:normal;font-weight:400;src:url(data:font/ttf;base64,${rtkPrimitivesBase64}) format('truetype')}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/><style>${fontFace}html,body{margin:0;height:100%;background:#0d0b14;overflow:hidden}#app{width:100vw;height:100vh}canvas{display:block;image-rendering:pixelated}</style></head><body><div id="app"></div><script>${arenaBundle}</script></body></html>`;
}
