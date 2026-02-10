import { state } from "./state";

// Convert a node/offset to an absolute character offset within contentEl
export function nodeOffsetToAbsolute(targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(state.contentEl!, NodeFilter.SHOW_TEXT, null);
  let abs = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === targetNode) return abs + targetOffset;
    abs += walker.currentNode.textContent!.length;
  }
  return abs + targetOffset;
}

// Resolve absolute offset to node/offset pair (survives DOM changes)
export function absoluteToNodeOffset(absOffset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(state.contentEl!, NodeFilter.SHOW_TEXT, null);
  let remaining = absOffset;
  while (walker.nextNode()) {
    const len = walker.currentNode.textContent!.length;
    if (remaining <= len) return { node: walker.currentNode, offset: remaining };
    remaining -= len;
  }
  return null;
}

// Extract text between absolute offsets
export function getAbsText(absStart: number, absEnd: number): string {
  const walker = document.createTreeWalker(state.contentEl!, NodeFilter.SHOW_TEXT, null);
  let result = "";
  let pos = 0;
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent!;
    const nodeEnd = pos + t.length;
    if (nodeEnd > absStart && pos < absEnd) {
      const s = Math.max(0, absStart - pos);
      const e = Math.min(t.length, absEnd - pos);
      result += t.slice(s, e);
    }
    pos = nodeEnd;
    if (pos >= absEnd) break;
  }
  return result;
}

// Extract text from position forward, walking through text nodes
export function getTextFromPosition(
  startNode: Node,
  startOffset: number,
  maxChars: number,
): string {
  let text = "";
  const walker = document.createTreeWalker(state.contentEl!, NodeFilter.SHOW_TEXT, null);
  walker.currentNode = startNode;
  text += startNode.textContent!.slice(startOffset);
  while (text.length < maxChars && walker.nextNode()) {
    text += walker.currentNode.textContent;
  }
  return text.slice(0, maxChars);
}

// Extract text backward from position, walking through preceding text nodes
export function getTextBeforePosition(
  startNode: Node,
  startOffset: number,
  maxChars: number,
): string {
  let text = startNode.textContent!.slice(0, startOffset);
  const walker = document.createTreeWalker(state.contentEl!, NodeFilter.SHOW_TEXT, null);
  walker.currentNode = startNode;
  while (text.length < maxChars && walker.previousNode()) {
    text = walker.currentNode.textContent + text;
  }
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars);
  }
  return text;
}
