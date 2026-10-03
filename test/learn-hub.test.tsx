// @vitest-environment jsdom

/**
 * The Learn tab's root is a hub now, and the RTK path is a screen below it, so
 * what can break is the wiring: a card that goes nowhere, or a Continue that
 * opens the wrong node. Lives here rather than beside the screen because
 * expo-router bundles every .tsx under app/ as a route.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COURSE_RTK, type PathSummary } from "@/lib/rtk-course";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  path: {
    summary: null as PathSummary | null,
    unavailable: false,
  },
}));

vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));

vi.mock("@/hooks/useRtkPath", () => ({ useRtkPath: () => h.path }));

vi.mock("react-native", () => ({
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/card", () => ({
  PressableCard: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/icons", () => ({
  ChevronRight: () => <span>chevron</span>,
  GraduationCap: () => <span>cap</span>,
}));

import LearnHome from "@/app/(tabs)/learn/index";

function summary(over: Partial<PathSummary> = {}): PathSummary {
  return {
    rows: [{ unit: 1, crowns: [3, 1, 0], earned: 4, possible: 9 }],
    earned: 4,
    possible: 9,
    next: { course: COURSE_RTK, unit: 1, node: 1 },
    ...over,
  };
}

beforeEach(() => {
  h.push.mockClear();
  h.path = { summary: summary(), unavailable: false };
});

afterEach(cleanup);

describe("the Learn hub", () => {
  it("offers the course as its own entry point", () => {
    render(<LearnHome />);
    fireEvent.click(screen.getByText("Remembering the Kanji"));
    expect(h.push).toHaveBeenCalledWith("/learn/rtk");
  });

  it("states the course's progress", () => {
    render(<LearnHome />);
    expect(screen.getByText(/4 of 9 crowns/)).toBeTruthy();
  });

  it("continues into the next node, skipping the path", () => {
    render(<LearnHome />);
    fireEvent.click(screen.getByText("Continue"));
    expect(h.push).toHaveBeenCalledWith("/learn/node?unit=1&node=1");
  });

  it("names the course before its progress has loaded", () => {
    h.path = { summary: null, unavailable: false };
    render(<LearnHome />);
    expect(screen.getByText("Remembering the Kanji")).toBeTruthy();
    expect(screen.queryByText("Continue")).toBeNull();
  });

  it("says the dictionary is missing rather than offering a dead Continue", () => {
    h.path = { summary: null, unavailable: true };
    render(<LearnHome />);
    expect(screen.getByText(/needs the dictionary/)).toBeTruthy();
    expect(screen.queryByText("Continue")).toBeNull();
  });

  it("drops Continue once every crown is earned", () => {
    h.path = { summary: summary({ next: null, earned: 9 }), unavailable: false };
    render(<LearnHome />);
    expect(screen.queryByText("Continue")).toBeNull();
    expect(screen.getByText(/9 of 9 crowns/)).toBeTruthy();
  });
});
