import React from "react";

export interface ReaderViewRef {
  postMessage: (data: string) => void;
  focus: () => void;
}

export const ReaderView: React.ForwardRefExoticComponent<
  { html: string; onMessage: (data: string) => void } & React.RefAttributes<ReaderViewRef>
>;
