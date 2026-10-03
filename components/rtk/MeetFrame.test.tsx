// @vitest-environment jsdom

/**
 * The Meet step's one fragile mechanism: MnemonicEditor reads `initialValue`
 * once, so a regenerate has to replace the text by remounting the editor. That
 * must happen when a NEW story lands and never while one is merely on its way —
 * otherwise a regenerate throws away the tweaks the learner just made.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MeetFrame } from "@/components/rtk/MeetFrame";
import type { GenerationState } from "@/hooks/useMnemonicGeneration";
import type { CourseFrame } from "@/lib/rtk-course";

vi.mock("react-native", () => ({
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: (props: { value?: string }) => <input value={props.value ?? ""} readOnly />,
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/PrimitiveChips", () => ({ PrimitiveChips: () => <span>CHIPS</span> }));
vi.mock("@/components/MnemonicText", () => ({
  MnemonicText: ({ mnemonic }: { mnemonic?: string | null }) => <span>SHOWN:{mnemonic}</span>,
}));

// Each mount reports a fresh instance id, which is how a remount is detected.
let mounts = 0;
vi.mock("@/components/MnemonicEditor", () => ({
  MnemonicEditor: ({ initialValue, onCancel }: { initialValue: string; onCancel: () => void }) => {
    const id = React.useMemo(() => ++mounts, []);
    return (
      <span>
        <span>{`EDITOR#${id}:${initialValue}`}</span>
        <button onClick={onCancel}>Cancel</button>
      </span>
    );
  },
}));

afterEach(cleanup);

const frame: CourseFrame = { literal: "親", index: 1621, keyword: "parent", lesson: 39 };

const nothing: GenerationState = {
  literal: null,
  story: null,
  attempt: 0,
  loading: false,
  message: null,
};

function view(generation: GenerationState, story: string | null = null) {
  return render(
    <MeetFrame
      frame={frame}
      primitives={[]}
      keyword={null}
      story={story}
      generation={generation}
      canGenerate
      onGenerate={() => {}}
      onSave={() => {}}
      onKeyword={() => {}}
      onKeep={() => {}}
      onSkip={() => {}}
    />,
  );
}

function editor(): string | null {
  // The innermost span, so the mock's Cancel button is not part of the text.
  const node = screen.queryByText(/^EDITOR#/, { selector: "span" });
  return node?.textContent ?? null;
}

describe("meeting a frame", () => {
  it("offers the choice before anything is generated", () => {
    view(nothing);
    expect(screen.getByText("Write it")).toBeTruthy();
    expect(screen.getByText("Generate")).toBeTruthy();
    expect(screen.getByText("Skip for now")).toBeTruthy();
    expect(editor()).toBeNull();
  });

  it("shows a story it already has, and offers to move on", () => {
    view(nothing, "a [tree] stands");
    expect(screen.getByText("SHOWN:a [tree] stands")).toBeTruthy();
    expect(screen.getByText("Edit it")).toBeTruthy();
    expect(screen.getByText("Next frame")).toBeTruthy();
  });

  it("opens the editor on a generated story", () => {
    view({ literal: "親", story: "the needle", attempt: 1, loading: false, message: null });
    expect(editor()).toBe("EDITOR#1:the needle");
  });

  it("ignores a story generated for another frame", () => {
    view({ literal: "何", story: "elsewhere", attempt: 1, loading: false, message: null });
    expect(editor()).toBeNull();
  });
});

describe("the first generate", () => {
  it("waits with a spinner rather than an empty editor", () => {
    view({ literal: "親", story: null, attempt: 0, loading: true, message: null });
    expect(editor()).toBeNull();
    expect(screen.getByText("Writing a story…")).toBeTruthy();
  });
});

describe("regenerating", () => {
  it("keeps the same editor while the next story is on its way", () => {
    const ready: GenerationState = {
      literal: "親",
      story: "the needle",
      attempt: 1,
      loading: false,
      message: null,
    };
    const { rerender } = view(ready);
    const first = editor();

    // What a regenerate looks like mid-flight: same story, loading.
    rerender(
      <MeetFrame
        frame={frame}
        primitives={[]}
        keyword={null}
        story={null}
        generation={{ ...ready, loading: true }}
        canGenerate
        onGenerate={() => {}}
        onSave={() => {}}
        onKeyword={() => {}}
        onKeep={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(editor()).toBe(first);
  });

  it("keeps the same editor when the regenerate is refused", () => {
    const ready: GenerationState = {
      literal: "親",
      story: "the needle",
      attempt: 1,
      loading: false,
      message: null,
    };
    const { rerender } = view(ready);
    const first = editor();

    rerender(
      <MeetFrame
        frame={frame}
        primitives={[]}
        keyword={null}
        story={null}
        generation={{ ...ready, message: "Daily AI quota reached." }}
        canGenerate
        onGenerate={() => {}}
        onSave={() => {}}
        onKeyword={() => {}}
        onKeep={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(editor()).toBe(first);
  });

  it("replaces the editor when a new story lands", () => {
    const ready: GenerationState = {
      literal: "親",
      story: "the needle",
      attempt: 1,
      loading: false,
      message: null,
    };
    const { rerender } = view(ready);
    const first = editor();

    rerender(
      <MeetFrame
        frame={frame}
        primitives={[]}
        keyword={null}
        story={null}
        generation={{ ...ready, story: "a second story", attempt: 2 }}
        canGenerate
        onGenerate={() => {}}
        onSave={() => {}}
        onKeyword={() => {}}
        onKeep={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(editor()).not.toBe(first);
    expect(editor()).toContain("a second story");
  });
});

describe("after cancelling", () => {
  it("reopens the editor when Generate is tapped again", () => {
    const ready: GenerationState = {
      literal: "親",
      story: "the needle",
      attempt: 1,
      loading: false,
      message: null,
    };
    view(ready);
    expect(editor()).toBeTruthy();

    // MnemonicEditor owns Cancel; this stands in for it.
    fireEvent.click(screen.getByText("Cancel"));
    expect(editor()).toBeNull();

    fireEvent.click(screen.getByText("Generate"));
    expect(editor()).toBeTruthy();
  });
});

describe("a refused regenerate", () => {
  it("says so while the editor is still open", () => {
    view({
      literal: "親",
      story: "the needle",
      attempt: 1,
      loading: false,
      message: "Daily AI quota reached.",
    });
    expect(editor()).toBeTruthy();
    expect(screen.getByText("Daily AI quota reached.")).toBeTruthy();
  });
});

describe("without the strokes tier", () => {
  it("will not generate a story with no primitives to weave", () => {
    render(
      <MeetFrame
        frame={frame}
        primitives={[]}
        keyword={null}
        story={null}
        generation={nothing}
        canGenerate={false}
        onGenerate={() => {}}
        onSave={() => {}}
        onKeyword={() => {}}
        onKeep={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText("needs stroke data")).toBeTruthy();
    expect(screen.getByText("Generate").closest("button")?.disabled).toBe(true);
  });
});
