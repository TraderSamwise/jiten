import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type { ArenaViewProps, ArenaViewRef } from "./types";

// Generic offline WebView host for the kanji-arena game bundle. Knows nothing
// about the game — it forwards `html` in and `postMessage` both ways. Mirrors
// the reader's ReaderView so the game stays a droppable, host-agnostic module.
const ArenaWebViewImpl = forwardRef<ArenaViewRef, ArenaViewProps>(({ html, onMessage }, ref) => {
  const webViewRef = useRef<WebView>(null);

  useImperativeHandle(ref, () => ({
    postMessage: (data: string) => {
      webViewRef.current?.postMessage(data);
    },
    focus: () => {},
  }));

  function handleMessage(event: WebViewMessageEvent) {
    onMessage(event.nativeEvent.data);
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ html }}
      originWhitelist={["*"]}
      onMessage={handleMessage}
      scrollEnabled={false}
      bounces={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1, backgroundColor: "transparent" }}
    />
  );
});

ArenaWebViewImpl.displayName = "ArenaWebView";

// Memoized so host-screen re-renders (e.g. the story-edit modal's state) never
// hand the WebView a fresh `source` object, which would reload and reset the game.
export const ArenaWebView = React.memo(ArenaWebViewImpl);
