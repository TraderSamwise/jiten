import { Platform } from "react-native";

/**
 * When using measureInWindow() the returned coordinates are relative to the
 * viewport.  On native `position: "absolute"` works because the root view
 * fills the entire screen, so absolute == viewport.  On web that is NOT
 * guaranteed — the nearest positioned ancestor may be offset from the
 * viewport — so we need `position: "fixed"` instead.
 *
 * React Native types `position` as "absolute" | "relative" | "static", and
 * Reanimated narrows it further, so "fixed" does not typecheck against an
 * Animated.View style even though react-native-web accepts it at runtime. The
 * web value is therefore asserted to "absolute": the type is a lie the RN
 * typings force, the runtime value is the correct one.
 */
export const viewportPosition = (Platform.OS === "web" ? "fixed" : "absolute") as "absolute";
