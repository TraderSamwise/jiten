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
  // className comes through: whether an action is the weighted one on the screen
  // is the difference between a button and a line of small print.
  Pressable: ({
    children,
    onPress,
    disabled,
    className,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button onClick={onPress} disabled={disabled} className={className}>
      {children}
    </button>
  ),
  // The keyword override lives entirely in these three props; a mock that drops
  // them leaves the whole path untested.
  TextInput: ({
    value,
    onChangeText,
    onSubmitEditing,
    onBlur,
  }: {
    value?: string;
    onChangeText?: (t: string) => void;
    onSubmitEditing?: () => void;
    onBlur?: () => void;
  }) => (
    <input
      aria-label="keyword"
      value={value ?? ""}
      onChange={(e) => onChangeText?.(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmitEditing?.();
      }}
      onBlur={() => onBlur?.()}
    />
  ),
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

function view(
  generation: GenerationState,
  story: string | null = null,
  glyphOrigin: string | null = null,
) {
  return render(
    <MeetFrame
      frame={frame}
      primitives={[]}
      keyword={null}
      glyphOrigin={glyphOrigin}
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

describe("the keyword", () => {
  const field = () => screen.getByLabelText("keyword");

  it("shows Heisig's until the learner sets their own", () => {
    view(nothing);
    expect(screen.getByText("parent")).toBeTruthy();
    cleanup();
    render(
      <MeetFrame
        frame={frame}
        primitives={[]}
        keyword="folks"
        story={null}
        generation={nothing}
        canGenerate
        onGenerate={() => {}}
        onSave={() => {}}
        onKeyword={() => {}}
        onKeep={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText("folks")).toBeTruthy();
  });

  it("saves what was typed on Enter", () => {
    const onKeyword = vi.fn();
    render(
      <MeetFrame
        frame={frame}
        primitives={[]}
        keyword={null}
        story={null}
        generation={nothing}
        canGenerate
        onGenerate={() => {}}
        onSave={() => {}}
        onKeyword={onKeyword}
        onKeep={() => {}}
        onSkip={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("parent"));
    fireEvent.change(field(), { target: { value: "folks" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onKeyword).toHaveBeenCalledWith("folks");
  });

  it("saves it on blur too, rather than discarding it", () => {
    const onKeyword = vi.fn();
    render(
      <MeetFrame
        frame={frame}
        primitives={[]}
        keyword={null}
        story={null}
        generation={nothing}
        canGenerate
        onGenerate={() => {}}
        onSave={() => {}}
        onKeyword={onKeyword}
        onKeep={() => {}}
        onSkip={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("parent"));
    fireEvent.change(field(), { target: { value: "kin" } });
    fireEvent.blur(field());
    expect(onKeyword).toHaveBeenCalledWith("kin");
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

describe("a story landing while the learner is writing their own", () => {
  const props = (generation: GenerationState) => ({
    frame,
    primitives: [],
    keyword: null,
    story: null,
    generation,
    canGenerate: true,
    onGenerate: () => {},
    onSave: () => {},
    onKeyword: () => {},
    onKeep: () => {},
    onSkip: () => {},
  });

  it("does not replace it", () => {
    const loading: GenerationState = {
      literal: "親",
      story: null,
      attempt: 0,
      loading: true,
      message: null,
    };
    const { rerender } = render(<MeetFrame {...props(loading)} />);

    // They tapped Generate, then opened the editor themselves while it ran.
    fireEvent.click(screen.getByText("Write it"));
    expect(editor()).toBeTruthy();

    rerender(
      <MeetFrame
        {...props({
          literal: "親",
          story: "the machine's",
          attempt: 1,
          loading: false,
          message: null,
        })}
      />,
    );
    // The editor is not re-seeded with the machine's story, so whatever they
    // typed is still what is in front of them.
    expect(editor()).not.toContain("the machine's");
  });

  it("does replace it when they ask for a regenerate", () => {
    const ready: GenerationState = {
      literal: "親",
      story: "the first",
      attempt: 1,
      loading: false,
      message: null,
    };
    const { rerender } = render(<MeetFrame {...props(ready)} />);
    const first = editor();

    fireEvent.click(screen.getByText("Regenerate"));
    rerender(<MeetFrame {...props({ ...ready, story: "the second", attempt: 2 })} />);
    expect(editor()).not.toBe(first);
    expect(editor()).toContain("the second");
  });
});

describe("without the strokes tier", () => {
  it("waits while the stroke data is still coming, and says so", () => {
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
    expect(screen.getByText("stroke data is loading…")).toBeTruthy();
    expect(screen.getByText("Generate").closest("button")?.disabled).toBe(true);
  });
});

describe("where the character comes from", () => {
  it("offers the real history beside the parts", () => {
    view(nothing, null, "Phono-semantic compound: phonetic 辛 + semantic 見 (see).");
    expect(screen.getByText("Where it comes from")).toBeTruthy();
    expect(screen.getByText(/phonetic 辛/)).toBeTruthy();
  });

  it("says nothing when the dictionary has none", () => {
    // Most devices, until the prose arrives with dict base v25.
    view(nothing);
    expect(screen.queryByText("Where it comes from")).toBeNull();
  });
});

describe("moving on", () => {
  /** The button that carries the label, not the <span> inside it. */
  function control(label: string): HTMLButtonElement {
    const button = screen.getByText(label).closest("button");
    if (!button) throw new Error(`${label} is not a button`);
    return button as HTMLButtonElement;
  }

  it("makes Next frame the weighted action once there is a story", () => {
    // It used to be a line of muted text under two real buttons — the action
    // taken on every single frame, dressed as a footnote.
    view(nothing, "a [tree] stands");
    expect(control("Next frame").className).toContain("bg-primary");
    expect(control("Generate").className).not.toContain("bg-primary");
  });

  it("still offers Skip as a button, with Generate leading", () => {
    view(nothing);
    expect(control("Skip for now").className).toContain("border");
    expect(control("Generate").className).toContain("bg-primary");
  });
});
