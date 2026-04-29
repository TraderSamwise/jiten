import type React from "react";
import type { ReaderViewProps, ReaderViewRef } from "./types";

export const ReaderView: React.ForwardRefExoticComponent<
  ReaderViewProps & React.RefAttributes<ReaderViewRef>
>;
