import { describe, expect, it } from "vitest";
import {
  displayToPdf,
  fitScale,
  normalizeRotation,
  pdfToDisplay,
  rotatedPageSize,
} from "../features/workspace/geometry";

const page = { width: 600, height: 800 };

describe("page coordinate transforms", () => {
  it("maps PDF and display coordinates round-trip for every rotation", () => {
    const point = { x: 123.5, y: 456.25 };
    for (const rotation of [0, 90, 180, 270]) {
      const display = pdfToDisplay(point, page, 1.5, rotation);
      const restored = displayToPdf(display, page, 1.5, rotation);
      expect(restored.x).toBeCloseTo(point.x, 6);
      expect(restored.y).toBeCloseTo(point.y, 6);
    }
  });

  it("rotates display dimensions for quarter turns", () => {
    expect(rotatedPageSize(page, 0)).toEqual({ width: 600, height: 800 });
    expect(rotatedPageSize(page, 90)).toEqual({ width: 800, height: 600 });
    expect(rotatedPageSize(page, 180)).toEqual({ width: 600, height: 800 });
    expect(rotatedPageSize(page, 270)).toEqual({ width: 800, height: 600 });
  });

  it("places the PDF bottom-left corner at the display bottom-left when unrotated", () => {
    expect(pdfToDisplay({ x: 0, y: 0 }, page, 1, 0)).toEqual({ x: 0, y: 800 });
    expect(pdfToDisplay({ x: 600, y: 800 }, page, 1, 0)).toEqual({ x: 600, y: 0 });
  });

  it("normalizes arbitrary rotation values", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
  });

  it("computes fit scales without collapsing to zero", () => {
    expect(fitScale({ width: 800, height: 1000 }, page, "fit-width", 0)).toBeCloseTo(800 / 600, 6);
    expect(fitScale({ width: 100, height: 100 }, page, "fit-page", 0)).toBeGreaterThan(0);
  });
});
