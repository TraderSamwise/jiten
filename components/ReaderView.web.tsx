import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";

export interface ReaderViewRef {
  postMessage: (data: string) => void;
}

interface ReaderViewProps {
  html: string;
  onMessage: (data: string) => void;
}

/**
 * Web implementation: renders reader HTML in an iframe.
 * Injects a shim so ReactNativeWebView.postMessage calls parent.postMessage.
 */
export const ReaderView = forwardRef<ReaderViewRef, ReaderViewProps>(({ html, onMessage }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Inject shim for ReactNativeWebView.postMessage → parent.postMessage
  const shimmedHtml = html.replace(
    "<head>",
    `<head><script>window.ReactNativeWebView={postMessage:function(d){window.parent.postMessage(d,'*')}}</script>`,
  );

  useImperativeHandle(ref, () => ({
    postMessage: (data: string) => {
      iframeRef.current?.contentWindow?.postMessage(data, "*");
    },
  }));

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Only accept messages from our iframe
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
        style={styles.iframe as any}
        sandbox="allow-scripts allow-same-origin"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  iframe: {
    width: "100%",
    height: "100%",
    border: "none",
  } as any,
});
