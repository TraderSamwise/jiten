import React, { useRef } from "react";
import {
  findNodeHandle,
  Keyboard,
  Platform,
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
  const start = useRef({ x: 0, y: 0, t: 0, id: "", valid: false });

  const onTouchStart = (e: GestureResponderEvent) => {
    const ne = e.nativeEvent;
    // Only a single-finger gesture can be a tap-to-dismiss; a second finger
    // (pinch/scroll assist) invalidates so a later touchEnd can't spuriously fire.
    if (ne.touches.length > 1) {
      start.current.valid = false;
      return;
    }
    start.current = { x: ne.pageX, y: ne.pageY, t: e.timeStamp, id: ne.identifier, valid: true };
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    const ne = e.nativeEvent;
    const s = start.current;
    if (!s.valid || ne.identifier !== s.id || ne.touches.length > 0) return;
    const dx = Math.abs(ne.pageX - s.x);
    const dy = Math.abs(ne.pageY - s.y);
    if (dx > TAP_SLOP || dy > TAP_SLOP || e.timeStamp - s.t > TAP_MAX_MS) return;
    // Skip when the tap lands on the field already being edited (so tapping to
    // move the cursor doesn't close the keyboard). findNodeHandle is native-only
    // — react-native-web removed it, and web has no soft keyboard to dismiss.
    if (Platform.OS !== "web") {
      const focused = TextInput.State.currentlyFocusedInput();
      const focusedTag = focused ? findNodeHandle(focused as unknown as React.Component) : null;
      if (focusedTag != null && String(ne.target) === String(focusedTag)) return;
    }
    Keyboard.dismiss();
  };

  return (
    <View style={[styles.flex, style]} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
