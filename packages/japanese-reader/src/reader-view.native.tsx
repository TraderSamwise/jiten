import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type { ReaderViewProps, ReaderViewRef } from "./types";

export const ReaderView = forwardRef<ReaderViewRef, ReaderViewProps>(({ html, onMessage }, ref) => {
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

  // iOS jettisons a backgrounded WKWebView's content process under memory
  // pressure. The view survives but its document is gone, so the reader comes
  // back blank — nothing re-renders it without an explicit reload. The reader
  // HTML carries its own scroll position, so reloading restores the page.
  function handleContentProcessDidTerminate() {
    webViewRef.current?.reload();
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ html }}
      originWhitelist={["*"]}
      onMessage={handleMessage}
      onContentProcessDidTerminate={handleContentProcessDidTerminate}
      onRenderProcessGone={handleContentProcessDidTerminate}
      scrollEnabled={false}
      bounces={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1, backgroundColor: "transparent" }}
    />
  );
});
