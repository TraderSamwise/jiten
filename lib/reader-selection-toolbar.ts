type SelectionToolbarPositionOptions = {
  anchorX: number;
  anchorY: number;
  readerTop: number;
  screenWidth: number;
  screenHeight: number;
  toolbarWidth: number;
  toolbarHeight: number;
  toolbarGap: number;
  popupSafeZone: number;
  sideMargin: number;
};

export function getSelectionToolbarPosition(options: SelectionToolbarPositionOptions): {
  top: number;
  left: number;
} {
  const {
    anchorX,
    anchorY,
    readerTop,
    screenWidth,
    screenHeight,
    toolbarWidth,
    toolbarHeight,
    toolbarGap,
    popupSafeZone,
    sideMargin,
  } = options;

  const maxLeft = Math.max(sideMargin, screenWidth - toolbarWidth - sideMargin);
  const rawLeft = anchorX - toolbarWidth / 2;
  const left = Math.max(sideMargin, Math.min(rawLeft, maxLeft));

  const rawTop = readerTop + anchorY - toolbarHeight - toolbarGap;
  const maxTop = screenHeight - popupSafeZone;
  const top = Math.max(readerTop, Math.min(rawTop, maxTop));

  return { top, left };
}
