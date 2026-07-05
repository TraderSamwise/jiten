import React from "react";
import {
  Keyboard,
  TouchableWithoutFeedback,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * App-wide "tap outside a text field to blur it". A tap on any non-interactive
 * area bubbles to this wrapper and dismisses the keyboard, which resigns the
 * focused input → fires its onBlur (and any blur-triggered save). Taps claimed by
 * inputs, buttons, and scroll/pan gestures keep their own behavior and never reach here.
 */
export function KeyboardDismissView({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableWithoutFeedback accessible={false} onPress={() => Keyboard.dismiss()}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </TouchableWithoutFeedback>
  );
}
