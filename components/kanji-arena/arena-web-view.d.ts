import type React from "react";
import type { ArenaViewProps, ArenaViewRef } from "./types";

// Type shim so `./arena-web-view` resolves at typecheck; Metro picks the
// platform-specific .native.tsx / .web.tsx implementation at runtime.
export const ArenaWebView: React.ForwardRefExoticComponent<
  ArenaViewProps & React.RefAttributes<ArenaViewRef>
>;
