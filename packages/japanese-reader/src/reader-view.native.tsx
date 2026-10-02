import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type { ReaderViewProps, ReaderViewRef } from "./types";

/**
 * Everything WebKit offers to put in the bar a long press raises.
 *
 * A second line of defence only: `suppressMenuItems` is a `canPerformAction:`
 * filter over a fixed selector map, so it reaches Copy, Cut and Paste but not
 * Look Up, Explain or Open in, which are menu elements rather than actions.
 * `textInteractionEnabled` below is the one that should settle it.
 */
const SUPPRESSED_MENU_ITEMS = [
  "cut",
  "copy",
  "paste",
  "replace",
  "bold",
  "italic",
  "underline",
  "select",
  "selectAll",
  "translate",
  "lookup",
  "share",
] as const;

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
        // No selection for iOS to raise a bar over. A WKPreferences value, so
        // `caretRangeFromPoint` and the reader's own selection are untouched.
        textInteractionEnabled={false}
        suppressMenuItems={[...SUPPRESSED_MENU_ITEMS]}
        scrollEnabled={false}
        bounces={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    );
  },
);
