import { describe, expect, test } from "vitest";

import { getSelectionToolbarPosition } from "./reader-selection-toolbar";

describe("getSelectionToolbarPosition", () => {
  test("centers around the selection when there is room", () => {
    expect(
      getSelectionToolbarPosition({
        anchorX: 200,
        anchorY: 220,
        readerTop: 80,
        screenWidth: 400,
        screenHeight: 900,
        toolbarWidth: 120,
        toolbarHeight: 32,
        toolbarGap: 24,
        popupSafeZone: 380,
        sideMargin: 8,
      }),
    ).toEqual({ top: 244, left: 140 });
  });

  test("clamps to the left edge when selection is near the side", () => {
    expect(
      getSelectionToolbarPosition({
        anchorX: 24,
        anchorY: 220,
        readerTop: 80,
        screenWidth: 400,
        screenHeight: 900,
        toolbarWidth: 160,
        toolbarHeight: 32,
        toolbarGap: 24,
        popupSafeZone: 380,
        sideMargin: 8,
      }),
    ).toEqual({ top: 244, left: 8 });
  });

  test("clamps to the right edge when expanded menu is wide", () => {
    expect(
      getSelectionToolbarPosition({
        anchorX: 360,
        anchorY: 220,
        readerTop: 80,
        screenWidth: 400,
        screenHeight: 900,
        toolbarWidth: 180,
        toolbarHeight: 76,
        toolbarGap: 24,
        popupSafeZone: 380,
        sideMargin: 8,
      }),
    ).toEqual({ top: 200, left: 212 });
  });

  test("keeps the toolbar above the popup safe zone", () => {
    expect(
      getSelectionToolbarPosition({
        anchorX: 200,
        anchorY: 880,
        readerTop: 80,
        screenWidth: 400,
        screenHeight: 900,
        toolbarWidth: 140,
        toolbarHeight: 32,
        toolbarGap: 24,
        popupSafeZone: 380,
        sideMargin: 8,
      }),
    ).toEqual({ top: 520, left: 130 });
  });
});
