import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Annotation, AnnotationKind, Point, Tool } from "../../types";
import {
  annotationBounds,
  createAnnotation,
  hitTestAnnotation,
  toolToKind,
} from "./model";
import { displayToPdf, pdfToDisplay, type Size } from "../workspace/geometry";

type Props = {
  docId: string;
  pageIndex: number;
  /** Unrotated PDF page size in points. */
  page: Size;
  /** Rotated display size in CSS pixels. */
  display: Size;
  scale: number;
  rotation: number;
  annotations: Annotation[];
  tool: Tool;
  color: string;
  strokeWidth: number;
  opacity: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (annotation: Annotation) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  onOpenNote: (annotation: Annotation) => void;
  onRequestText: (kind: "text" | "note", point: Point) => void;
};

type DraftState = {
  kind: AnnotationKind;
  points: Point[];
  start: Point;
  current: Point;
};

export function AnnotationLayer({
  docId,
  pageIndex,
  page,
  display,
  scale,
  rotation,
  annotations,
  tool,
  color,
  strokeWidth,
  opacity,
  selectedId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onOpenNote,
  onRequestText,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [dragging, setDragging] = useState<{ id: string; start: Point; original: Point[] } | null>(null);
  const drawingEnabled = useMemo(
    () => toolToKind(tool) !== null,
    [tool],
  );

  const toPdf = (event: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return displayToPdf(
      {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * display.width,
        y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * display.height,
      },
      page,
      scale,
      rotation,
    );
  };

  const screen = (point: Point) => pdfToDisplay(point, page, scale, rotation);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (tool === "select" || tool === "hand") return;
    const point = toPdf(event);

    if (tool === "eraser") {
      const tolerance = 8 / scale;
      const target = [...annotations]
        .reverse()
        .find((annotation) => hitTestAnnotation(annotation, point, tolerance));
      if (target) {
        onDelete(target.id);
        onSelect(null);
      }
      return;
    }
    if (tool === "note" || tool === "text") {
      event.preventDefault();
      onRequestText(tool, point);
      return;
    }
    if (!drawingEnabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const kind = toolToKind(tool);
    if (!kind) return;
    setDraft({ kind, points: [point], start: point, current: point });
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragging) {
      const point = toPdf(event);
      const dx = point.x - dragging.start.x;
      const dy = point.y - dragging.start.y;
      onUpdate(dragging.id, {
        points: dragging.original.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      });
      return;
    }
    if (!draft) return;
    const point = toPdf(event);
    if (draft.kind === "pen" || draft.kind === "highlighter") {
      setDraft({ ...draft, points: [...draft.points, point], current: point });
    } else {
      setDraft({ ...draft, current: point, points: [draft.start, point] });
    }
  };

  const finishDraft = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragging) {
      setDragging(null);
      return;
    }
    if (!draft) return;
    const point = toPdf(event);
    let points: Point[] = draft.points;
    if (draft.kind === "pen" || draft.kind === "highlighter") {
      if (points.length < 2) points = [...points, point];
    } else {
      points = [draft.start, point];
    }
    const annotation = createAnnotation({
      docId,
      pageIndex,
      kind: draft.kind,
      color,
      opacity,
      strokeWidth,
      points,
    });
    setDraft(null);
    if (points.length > 1 && (Math.abs(points[0].x - points[points.length - 1].x) > 0.5 || Math.abs(points[0].y - points[points.length - 1].y) > 0.5)) {
      onCreate(annotation);
      onSelect(annotation.id);
    } else {
      onSelect(null);
    }
  };

  const renderPath = (annotation: Annotation) => {
    if (annotation.points.length === 0) return "";
    const [first, ...rest] = annotation.points;
    const start = screen(first);
    let path = `M ${start.x} ${start.y}`;
    for (const point of rest) {
      const mapped = screen(point);
      path += ` L ${mapped.x} ${mapped.y}`;
    }
    return path;
  };

  const draftPath = () => {
    if (!draft || draft.points.length === 0) return "";
    return renderPath({
      id: "draft",
      docId,
      pageIndex,
      kind: draft.kind,
      color,
      opacity,
      strokeWidth,
      points: draft.points,
      createdAt: 0,
      updatedAt: 0,
    });
  };

  const handleObjectPointerDown = (
    event: ReactPointerEvent<SVGRectElement>,
    annotation: Annotation,
  ) => {
    event.stopPropagation();
    if (tool === "eraser") {
      onDelete(annotation.id);
      onSelect(null);
      return;
    }
    if (tool !== "select") return;
    event.preventDefault();
    onSelect(annotation.id);
    const point = toPdf(event);
    setDragging({
      id: annotation.id,
      start: point,
      original: annotation.points.map((p) => ({ ...p })),
    });
    (event.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture(event.pointerId);
  };

  const draftBounds = (() => {
    if (!draft) return null;
    const points = draft.points.length ? draft.points : [draft.start, draft.current];
    return annotationBounds({
      id: "draft",
      docId,
      pageIndex,
      kind: draft.kind,
      color,
      opacity,
      strokeWidth,
      points,
      createdAt: 0,
      updatedAt: 0,
    });
  })();

  return (
    <div className="page-annotation-layer" style={{ pointerEvents: "none" }}>
      <svg
        ref={svgRef}
        className="drawing"
        viewBox={`0 0 ${display.width} ${display.height}`}
        preserveAspectRatio="none"
        role={drawingEnabled ? "application" : "img"}
        aria-label={`Annotations for page ${pageIndex + 1}`}
        style={{
          pointerEvents: tool === "select" || tool === "hand" ? "none" : "auto",
          cursor: tool === "select" ? "default" : tool === "hand" ? "grab" : "crosshair",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDraft}
        onPointerCancel={() => { setDraft(null); setDragging(null); }}
      >
        {annotations.map((annotation) => {
          const isSelected = selectedId === annotation.id;
          const box = annotationBounds(annotation);
          const topLeft = screen({ x: box.x, y: box.y + box.height });
          const bottomRight = screen({ x: box.x + box.width, y: box.y });
          const x = Math.min(topLeft.x, bottomRight.x);
          const y = Math.min(topLeft.y, bottomRight.y);
          const width = Math.abs(bottomRight.x - topLeft.x);
          const height = Math.abs(bottomRight.y - topLeft.y);
          const start = annotation.points[0] ? screen(annotation.points[0]) : { x, y };
          const end = annotation.points[1] ? screen(annotation.points[1]) : { x: x + width, y: y + height };
          const notePoint = annotation.points[0] ? screen(annotation.points[0]) : { x, y };
          return (
            <g key={annotation.id} aria-label={`${annotation.kind} on page ${annotation.pageIndex + 1}`}>
              {isSelected && (
                <rect
                  x={x - 3}
                  y={y - 3}
                  width={Math.max(6, width) + 6}
                  height={Math.max(6, height) + 6}
                  fill="none"
                  stroke="#6f9ceb"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {(annotation.kind === "pen" || annotation.kind === "highlighter") && (
                <path
                  d={renderPath(annotation)}
                  fill="none"
                  stroke={annotation.color}
                  strokeWidth={annotation.strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={annotation.kind === "highlighter" ? annotation.opacity * 0.55 : annotation.opacity}
                  style={{ pointerEvents: "none", mixBlendMode: annotation.kind === "highlighter" ? "multiply" : undefined }}
                />
              )}
              {annotation.kind === "rect" && (
                <rect x={x} y={y} width={Math.max(1, width)} height={Math.max(1, height)} fill="transparent" stroke={annotation.color} strokeWidth={annotation.strokeWidth} opacity={annotation.opacity} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
              )}
              {annotation.kind === "highlight" && (
                <rect x={x} y={y} width={Math.max(1, width)} height={Math.max(1, height)} fill={annotation.color} opacity={annotation.opacity * 0.55} rx={1} style={{ pointerEvents: "none", mixBlendMode: "multiply" }} />
              )}
              {annotation.kind === "ellipse" && (
                <ellipse cx={x + width / 2} cy={y + height / 2} rx={Math.max(1, width / 2)} ry={Math.max(1, height / 2)} fill="transparent" stroke={annotation.color} strokeWidth={annotation.strokeWidth} opacity={annotation.opacity} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
              )}
              {annotation.kind === "arrow" && (() => {
                const angle = Math.atan2(end.y - start.y, end.x - start.x);
                const head = 11;
                return (
                  <>
                    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={annotation.color} strokeWidth={annotation.strokeWidth} opacity={annotation.opacity} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
                    <polyline
                      points={`${end.x - head * Math.cos(angle - Math.PI / 6)},${end.y - head * Math.sin(angle - Math.PI / 6)} ${end.x},${end.y} ${end.x - head * Math.cos(angle + Math.PI / 6)},${end.y - head * Math.sin(angle + Math.PI / 6)}`}
                      fill="none"
                      stroke={annotation.color}
                      strokeWidth={annotation.strokeWidth}
                      opacity={annotation.opacity}
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "none" }}
                    />
                  </>
                );
              })()}
              {annotation.kind === "text" && annotation.text && (
                <text x={start.x} y={start.y} fill={annotation.color} fontSize={(annotation.fontSize ?? 12) * scale} fontFamily="Segoe UI, sans-serif" opacity={annotation.opacity} style={{ pointerEvents: "none", userSelect: "none" }}>
                  {annotation.text}
                </text>
              )}
              {annotation.kind === "note" && (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={notePoint.x} cy={notePoint.y} r={9} fill={annotation.color} opacity={0.95} />
                  <text x={notePoint.x - 2.5} y={notePoint.y + 3.5} fill="#141414" fontSize={10} fontWeight={700} fontFamily="Segoe UI, sans-serif">i</text>
                </g>
              )}
              {annotation.kind === "image" && annotation.imageData && (
                <image
                  href={annotation.imageData}
                  x={x}
                  y={y}
                  width={Math.max(8, width)}
                  height={Math.max(8, height)}
                  preserveAspectRatio="none"
                  opacity={annotation.opacity}
                  style={{ pointerEvents: "none" }}
                />
              )}
              <rect
                x={x - 6}
                y={y - 6}
                width={Math.max(12, width) + 12}
                height={Math.max(12, height) + 12}
                fill="transparent"
                stroke="transparent"
                style={{ pointerEvents: tool === "select" || tool === "eraser" ? "all" : "none", cursor: tool === "select" ? "move" : tool === "eraser" ? "not-allowed" : "default" }}
                onPointerDown={(event) => handleObjectPointerDown(event, annotation)}
                onDoubleClick={() => onOpenNote(annotation)}
              />
            </g>
          );
        })}
        {draft && draftPath() && (
          <path d={draftPath()} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} style={{ pointerEvents: "none" }} />
        )}
        {draft && draftBounds && (draft.kind === "rect" || draft.kind === "ellipse") && (() => {
          const topLeft = screen({ x: draftBounds.x, y: draftBounds.y + draftBounds.height });
          const bottomRight = screen({ x: draftBounds.x + draftBounds.width, y: draftBounds.y });
          const x = Math.min(topLeft.x, bottomRight.x);
          const y = Math.min(topLeft.y, bottomRight.y);
          const width = Math.abs(bottomRight.x - topLeft.x);
          const height = Math.abs(bottomRight.y - topLeft.y);
          if (draft.kind === "ellipse") {
            return <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill="transparent" stroke={color} strokeWidth={strokeWidth} strokeDasharray="4 3" style={{ pointerEvents: "none" }} />;
          }
          return <rect x={x} y={y} width={Math.max(1, width)} height={Math.max(1, height)} fill="transparent" stroke={color} strokeWidth={strokeWidth} strokeDasharray="4 3" style={{ pointerEvents: "none" }} />;
        })()}
      </svg>
    </div>
  );
}
