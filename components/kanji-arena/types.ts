export interface ArenaViewRef {
  postMessage: (data: string) => void;
  focus: () => void;
}

export interface ArenaViewProps {
  html: string;
  onMessage: (data: string) => void;
}
