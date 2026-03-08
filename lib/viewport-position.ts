import { Platform } from "react-native";

/**
 * When using measureInWindow() the returned coordinates are relative to the
 * viewport.  On native `position: "absolute"` works because the root view
 * fills the entire screen, so absolute == viewport.  On web that is NOT
 * guaranteed — the nearest positioned ancestor may be offset from the
 * viewport — so we need `position: "fixed"` instead.
 */
export const viewportPosition = Platform.OS === "web" ? ("fixed" as const) : ("absolute" as const);
