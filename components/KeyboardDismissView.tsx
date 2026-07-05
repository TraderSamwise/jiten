import React, { useRef } from "react";
import {
  findNodeHandle,
  Keyboard,
  StyleSheet,
  TextInput,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const TAP_SLOP = 8;
const TAP_MAX_MS = 400;

/**
 * App-wide "tap outside a text field to blur it". Uses passive touch events
 * (not a Pressable or gesture recognizer) so it never joins the responder
 * system — a Pressable wrapper steals scroll gestures and a gesture recognizer
 * around the native screen stack crashes on scroll. A drag moves past the slop
 * so only a real tap dismisses; a tap on the focused field itself is ignored.
 */
export function KeyboardDismissView({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const start = useRef({ x: 0, y: 0, t: 0 });

  const onTouchStart = (e: GestureResponderEvent) => {
    start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: e.timeStamp };
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    const dx = Math.abs(e.nativeEvent.pageX - start.current.x);
    const dy = Math.abs(e.nativeEvent.pageY - start.current.y);
    if (dx > TAP_SLOP || dy > TAP_SLOP || e.timeStamp - start.current.t > TAP_MAX_MS) return;
    const focused = TextInput.State.currentlyFocusedInput();
    const focusedTag = focused ? findNodeHandle(focused as unknown as React.Component) : null;
    if (focusedTag != null && String(e.nativeEvent.target) === String(focusedTag)) return;
    Keyboard.dismiss();
  };

  return (
    <View style={[styles.flex, style]} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
