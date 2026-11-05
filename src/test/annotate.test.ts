import { describe, expect, it } from "vitest";
import {
  annotationBounds,
  createAnnotation,
  hitTestAnnotation,
  parsePageRange,
  toolToKind,
} from "../features/annotate/model";

describe("annotation model", () => {
  it("maps tools to annotation kinds and rejects navigation tools", () => {
    expect(toolToKind("pen")).toBe("pen");
    expect(toolToKind("highlighter")).toBe("highlighter");
    expect(toolToKind("select")).toBeNull();
    expect(toolToKind("eraser")).toBeNull();
  });

  it("computes bounds from points regardless of direction", () => {
    const annotation = createAnnotation({
      docId: "doc-1",
      pageIndex: 2,
      kind: "rect",
      color: "#ff0000",
      opacity: 1,
      strokeWidth: 2,
      points: [
        { x: 40, y: 90 },
        { x: 10, y: 20 },
      ],
    });
    expect(annotationBounds(annotation)).toEqual({ x: 10, y: 20, width: 30, height: 70 });
  });

  it("hit-tests ink strokes near a segment and rejects distant points", () => {
    const annotation = createAnnotation({
      docId: "doc-1",
      pageIndex: 0,
      kind: "pen",
      color: "#000000",
      opacity: 1,
      strokeWidth: 2,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });
    expect(hitTestAnnotation(annotation, { x: 50, y: 3 }, 5)).toBe(true);
    expect(hitTestAnnotation(annotation, { x: 50, y: 30 }, 5)).toBe(false);
  });

  it("parses page ranges, deduplicates, and clamps to the document", () => {
    expect(parsePageRange("1-3, 3, 9", 8)).toEqual([0, 1, 2]);
    expect(parsePageRange("", 3)).toEqual([0, 1, 2]);
    expect(parsePageRange("0, 99", 4)).toEqual([]);
    expect(parsePageRange("4-2", 5)).toEqual([1, 2, 3]);
  });
});
