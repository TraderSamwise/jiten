import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

export interface ReaderViewRef {
  postMessage: (data: string) => void;
  focus: () => void;
}

interface ReaderViewProps {
  html: string;
  onMessage: (data: string) => void;
}

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
