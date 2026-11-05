import type { Annotation, AnnotationKind, Point, Tool } from "../../types";

export const INK_TOOLS = new Set<Tool>(["pen", "highlighter"]);
export const SHAPE_TOOLS = new Set<Tool>(["rect", "ellipse", "arrow"]);

export function toolToKind(tool: Tool): AnnotationKind | null {
  if (tool === "select" || tool === "hand" || tool === "eraser") return null;
  return tool;
}

export function makeId(prefix = "a"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createAnnotation(args: {
  docId: string;
  pageIndex: number;
  kind: AnnotationKind;
  color: string;
  opacity: number;
  strokeWidth: number;
  points: Point[];
  text?: string;
  fontSize?: number;
  imageData?: string;
}): Annotation {
  const now = Date.now();
  return {
    id: makeId(),
    createdAt: now,
    updatedAt: now,
    ...args,
  };
}

export function annotationBounds(annotation: Annotation): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (annotation.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of annotation.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function hitTestAnnotation(
  annotation: Annotation,
  point: Point,
  tolerance: number,
): boolean {
  if (annotation.points.length === 0) return false;
  if (annotation.points.length === 1) {
    return Math.hypot(point.x - annotation.points[0].x, point.y - annotation.points[0].y) <= tolerance;
  }
  if (annotation.kind === "pen" || annotation.kind === "highlighter") {
    for (let i = 1; i < annotation.points.length; i += 1) {
      if (pointSegmentDistance(point, annotation.points[i - 1], annotation.points[i]) <= tolerance) {
        return true;
      }
    }
    const bounds = annotationBounds(annotation);
    return (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    );
  }
  const bounds = annotationBounds(annotation);
  return (
    point.x >= bounds.x - tolerance &&
    point.x <= bounds.x + bounds.width + tolerance &&
    point.y >= bounds.y - tolerance &&
    point.y <= bounds.y + bounds.height + tolerance
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parsePageRange(input: string, pageCount: number): number[] {
  const trimmed = input.trim();
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i);
  const pages = new Set<number>();
  for (const token of trimmed.split(",")) {
    const part = token.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = clamp(Number(range[1]), 1, pageCount);
      const end = clamp(Number(range[2]), 1, pageCount);
      for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) {
        pages.add(page - 1);
      }
    } else if (/^\d+$/.test(part)) {
      const page = Number(part);
      if (page >= 1 && page <= pageCount) pages.add(page - 1);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export const DEFAULT_COLORS = [
  "#111111",
  "#6b7280",
  "#9ca3af",
  "#d1d5db",
  "#ffffff",
  "#f4a7a3",
  "#f4d06f",
  "#86c99a",
  "#7fb2ee",
  "#f2c9a8",
  "#e84b3c",
  "#f5b400",
  "#1f9d55",
  "#2563eb",
  "#c47c5a",
  "#a61b16",
  "#c47a00",
  "#157347",
  "#1d4ed8",
  "#7c4a2d",
];

export const HIGHLIGHT_COLORS = [
  "#ffe45c",
  "#ffb84d",
  "#9be37a",
  "#77d5f7",
  "#f7a3e8",
  "#ff8787",
];
