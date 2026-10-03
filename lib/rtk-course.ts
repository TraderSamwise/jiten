/**
 * The RTK course's pure spine: how 3,000 Heisig frames divide into units and
 * nodes, which exercises a node runs at each crown level, and whether a frame's
 * parts are known yet. No database, no React — see db/rtk-progress.ts for state.
 */

export const COURSE_RTK = "rtk";

/** Frames per node. Five is a session; an RTK lesson averages 39 and peaks at 142. */
export const NODE_SIZE = 5;

/** Crown 3 is a node drilled to production. Nothing schedules a crown-3 node. */
export const CROWN_MAX = 3;

export interface CourseFrame {
  literal: string;
  /** Heisig frame number, 1-based; the course's only ordering. */
  index: number;
  keyword: string;
  /**
   * RTK lesson, 1..56 — the course's unit. Null for frames 2201-3000: the
   * dictionary carries 3,000 keyworded frames but lessons only for volume 1's
   * 2,200, so those 800 have no unit to live in and are not on the path.
   */
  lesson: number | null;
}

export function isPathFrame(frame: CourseFrame): frame is CourseFrame & { lesson: number } {
  return typeof frame.lesson === "number" && Number.isFinite(frame.lesson) && frame.lesson > 0;
}

export interface NodeRef {
  course: string;
  unit: number;
  /** 0-based position of this node within its unit. */
  node: number;
}

export type NodeStep = "meet" | "recognise" | "identify" | "assemble" | "write" | "cloze";

/** One component of a kanji, as the decomposition tables describe it. */
export interface FrameComponent {
  glyph: string | null;
  /** True for RTK's invented primitives, which are not kanji and are never gated. */
  isPrimitive: boolean;
}

const NODE_ID_PATTERN = /^([a-z][a-z0-9-]*):(\d+):(\d+)$/;

/**
 * Derived, so two devices making the same node cannot make two rows for it.
 * Throws rather than return an id parseNodeId would reject, because that id is
 * the row's primary key and the only thing keeping the two devices together.
 */
export function nodeId(ref: NodeRef): string {
  const id = `${ref.course}:${ref.unit}:${ref.node}`;
  if (!NODE_ID_PATTERN.test(id)) throw new Error(`Not a node: ${id}`);
  return id;
}

export function parseNodeId(id: string): NodeRef | null {
  const m = NODE_ID_PATTERN.exec(id);
  if (!m) return null;
  return { course: m[1], unit: Number(m[2]), node: Number(m[3]) };
}

/** A node from `?unit=12&node=3`, or null when the link is not one. */
export function nodeRefFromParams(
  unit: string | undefined,
  node: string | undefined,
  course: string = COURSE_RTK,
): NodeRef | null {
  return parseNodeId(`${course}:${unit ?? ""}:${node ?? ""}`);
}

export function nodesInUnit(frameCount: number): number {
  if (frameCount <= 0) return 0;
  return Math.ceil(frameCount / NODE_SIZE);
}

/**
 * Frames in Heisig order, chunked into nodes. The last node may be short, and a
 * frame with no lesson is dropped rather than placed in a unit it has no claim to.
 */
export function splitUnitIntoNodes(frames: readonly CourseFrame[]): CourseFrame[][] {
  const ordered = frames.filter(isPathFrame).sort((a, b) => a.index - b.index);
  const nodes: CourseFrame[][] = [];
  for (let i = 0; i < ordered.length; i += NODE_SIZE) {
    nodes.push(ordered.slice(i, i + NODE_SIZE));
  }
  return nodes;
}

/**
 * Each pass drops the easiest exercise and adds a harder one, so a node is met
 * once and produced by crown 3. Cloze runs every pass and is skipped at runtime
 * for a frame with no story.
 */
const STEPS_BY_CROWN: readonly NodeStep[][] = [
  ["meet", "recognise", "identify", "cloze"],
  ["recognise", "identify", "assemble", "cloze"],
  ["identify", "assemble", "write", "cloze"],
];

export function stepsForCrown(crown: number): NodeStep[] {
  const steps = STEPS_BY_CROWN[crown];
  return steps ? [...steps] : [];
}

export function nextCrown(crown: number): number {
  return Math.min(crown + 1, CROWN_MAX);
}

export function isCracked(crown: number): boolean {
  return crown >= 1;
}

/**
 * A frame is introducible once every kanji it is built from is already known.
 * Invented primitives pass unconditionally — they are taught by the frame that
 * first uses them, which is how the book does it.
 */
export function introducible(
  components: readonly FrameComponent[],
  known: ReadonlySet<string>,
): boolean {
  return components.every((c) => c.isPrimitive || !c.glyph || known.has(c.glyph));
}

export interface UnitShape {
  unit: number;
  nodeCount: number;
}

export interface NodeCrowns {
  /** node id → crown level. A missing id means crown 0. */
  crownOf(id: string): number;
}

/** The node Continue resolves to: lowest unit, then lowest node, with crown < 3. */
export function nextNode(
  units: readonly UnitShape[],
  crowns: NodeCrowns,
  course: string = COURSE_RTK,
): NodeRef | null {
  for (const { unit, nodeCount } of [...units].sort((a, b) => a.unit - b.unit)) {
    for (let node = 0; node < nodeCount; node++) {
      const ref = { course, unit, node };
      if (crowns.crownOf(nodeId(ref)) < CROWN_MAX) return ref;
    }
  }
  return null;
}

/** One unit as the path draws it: a dot per node, carrying that node's crown. */
export interface UnitRow {
  unit: number;
  /** Crown level per node, in node order — the path's dots. */
  crowns: number[];
  earned: number;
  possible: number;
}

export interface PathSummary {
  rows: UnitRow[];
  /** Where Continue goes, or null when every node is at the cap. */
  next: NodeRef | null;
  earned: number;
  possible: number;
}

/** Everything the path screen renders, so the screen itself holds no arithmetic. */
export function pathSummary(
  units: readonly UnitShape[],
  crowns: NodeCrowns,
  course: string = COURSE_RTK,
): PathSummary {
  const rows = [...units]
    .sort((a, b) => a.unit - b.unit)
    .map(({ unit, nodeCount }) => {
      const perNode = Array.from({ length: Math.max(0, nodeCount) }, (_, node) =>
        Math.max(0, Math.min(crowns.crownOf(nodeId({ course, unit, node })), CROWN_MAX)),
      );
      return {
        unit,
        crowns: perNode,
        earned: perNode.reduce((a, b) => a + b, 0),
        possible: perNode.length * CROWN_MAX,
      };
    });
  return {
    rows,
    next: nextNode(units, crowns, course),
    earned: rows.reduce((n, r) => n + r.earned, 0),
    possible: rows.reduce((n, r) => n + r.possible, 0),
  };
}
