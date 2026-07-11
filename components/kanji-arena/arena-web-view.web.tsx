import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";

import type { ArenaViewProps, ArenaViewRef } from "./types";

// Web host: renders the game bundle in a sandboxed iframe and shims
// ReactNativeWebView.postMessage -> parent.postMessage so the same bridge code
// works on web and native.
const ArenaWebViewImpl = forwardRef<ArenaViewRef, ArenaViewProps>(({ html, onMessage }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const shimmedHtml = html.replace(
    "<head>",
    `<head><script>window.ReactNativeWebView={postMessage:function(d){window.parent.postMessage(d,'*')}}</script>`,
  );

  useImperativeHandle(ref, () => ({
    postMessage: (data: string) => {
      iframeRef.current?.contentWindow?.postMessage(data, "*");
    },
    focus: () => {
      iframeRef.current?.focus();
    },
  }));

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (typeof event.data === "string") {
        onMessage(event.data);
      }
    },
    [onMessage],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  return (
    <View style={styles.container}>
      <iframe
        ref={iframeRef}
        srcDoc={shimmedHtml}
        style={styles.iframe as React.CSSProperties}
        sandbox="allow-scripts allow-same-origin"
        title="Kanji Arena"
      />
    </View>
  );
});

ArenaWebViewImpl.displayName = "ArenaWebView";

// Memoized so host-screen re-renders (e.g. the story-edit modal's state) never
// recompute srcDoc / reload the iframe and reset the game.
export const ArenaWebView = React.memo(ArenaWebViewImpl);

const styles = StyleSheet.create({
  container: { flex: 1 },
  iframe: { width: "100%", height: "100%", border: "none" } as object,
});
