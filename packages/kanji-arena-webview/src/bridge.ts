import type Phaser from "phaser";
import type { ArenaCard, ArenaConfig, GameMessage, HostMessage } from "./protocol";
import { loadCorpus } from "./rtk/corpus";
import { seedFromSession } from "./rtk/srs";

// Post a message to the host — react-native-webview injects ReactNativeWebView;
// the web iframe host shims the same name onto window.parent.postMessage.
function send(msg: GameMessage): void {
  const s = JSON.stringify(msg);
  const rn = (window as unknown as { ReactNativeWebView?: { postMessage(d: string): void } })
    .ReactNativeWebView;
  if (rn?.postMessage) rn.postMessage(s);
  else window.parent?.postMessage(s, "*");
}

// The current session, indexed by kanji so a read can resolve its host token.
// Phase 2 will also feed these cards into the game's content queue; for now we
// receive them and map reads back so both bridge directions are exercised.
let sessionByKanji = new Map<string, ArenaCard>();

// The run's config (cohort mode / practice), captured from the session message.
// Data-only for now — scenes read it in later phases to shape scaffolding.
export const runConfig: ArenaConfig = {};

export function initBridge(game: Phaser.Game): void {
  window.addEventListener("message", (e: MessageEvent) => {
    let msg: HostMessage;
    try {
      msg = typeof e.data === "string" ? JSON.parse(e.data) : (e.data as HostMessage);
    } catch {
      return;
    }
    if (msg?.type === "session" && Array.isArray(msg.cards)) {
      sessionByKanji = new Map(msg.cards.map((c) => [c.kanji, c]));
      for (const k of Object.keys(runConfig)) delete (runConfig as Record<string, unknown>)[k];
      Object.assign(runConfig, msg.config ?? {});
      const count = loadCorpus(msg.cards);
      seedFromSession(msg.cards);
      game.events.emit("corpusReady", { count, config: runConfig });
    } else if (msg?.type === "story") {
      let kanji = msg.token;
      for (const [k, c] of sessionByKanji) {
        if (c.token === msg.token) {
          kanji = k;
          break;
        }
      }
      game.events.emit("storyDelivered", { token: msg.token, kanji, text: msg.text });
    }
  });

  // The game emits one "read" per committed recall attempt (DungeonScene), with
  // { kanji, keyword, ok, story }. We forward the pass/fail keyed to the host token.
  game.events.on("read", (r: { kanji: string; ok: boolean }) => {
    const token = sessionByKanji.get(r.kanji)?.token ?? r.kanji;
    send({ type: "result", token, correct: r.ok });
  });

  // A study alcove taught a new kanji — tell the host to enroll it (new→learning)
  // in the real SRS. The host ignores this in practice mode, like "result".
  game.events.on("taught", (r: { kanji: string }) => {
    const token = sessionByKanji.get(r.kanji)?.token ?? r.kanji;
    send({ type: "taught", token });
  });

  // One "runEnd" per death (DungeonScene.die) — report the run's recall summary.
  game.events.on("runEnd", (s: { reads: number; hits: number }) => {
    send({ type: "sessionEnd", summary: { reads: s.reads, hits: s.hits } });
  });

  // StudyScene asks the host to draft a mnemonic; the token comes from the session.
  game.events.on("requestStory", (r: { kanji: string; keyword: string; primitives: string[] }) => {
    const token = sessionByKanji.get(r.kanji)?.token ?? r.kanji;
    send({
      type: "requestStory",
      token,
      kanji: r.kanji,
      keyword: r.keyword,
      primitives: r.primitives,
    });
  });

  // StudyScene asks the host to open its editor with the current story text.
  game.events.on("editStory", (r: { kanji: string; current: string }) => {
    const token = sessionByKanji.get(r.kanji)?.token ?? r.kanji;
    send({ type: "editStory", token, current: r.current });
  });

  send({ type: "ready" });
}
