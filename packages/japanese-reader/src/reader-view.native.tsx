import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type { ReaderViewProps, ReaderViewRef } from "./types";

export const ReaderView = forwardRef<ReaderViewRef, ReaderViewProps>(
  ({ html, onMessage, onContentProcessTerminated }, ref) => {
    const webViewRef = useRef<WebView>(null);
    const [documentKey, setDocumentKey] = useState(0);

    useImperativeHandle(ref, () => ({
      postMessage: (data: string) => {
        webViewRef.current?.postMessage(data);
      },
      focus: () => {},
    }));

    function handleMessage(event: WebViewMessageEvent) {
      onMessage(event.nativeEvent.data);
    }

    // iOS jettisons a backgrounded WKWebView's content process; the view survives,
    // its document does not. reload() cannot repair an HTML-string source — its URL
    // is about:blank — and leaves the white spinner up, so remount to reload the HTML.
    function handleContentProcessDidTerminate() {
      setDocumentKey((key) => key + 1);
      onContentProcessTerminated?.();
    }

    return (
      <WebView
        key={documentKey}
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
  },
);
