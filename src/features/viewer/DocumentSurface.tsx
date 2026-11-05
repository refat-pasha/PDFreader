import { useCallback, useEffect, useRef, useState } from "react";
import { Highlighter, StickyNote, X } from "lucide-react";
import { AnnotationLayer } from "../annotate/AnnotationLayer";
import { createAnnotation } from "../annotate/model";
import type { Annotation, DocumentMeta, Point, Tool } from "../../types";
import { extractPageText, getPageSize, loadPdf, renderPageToCanvas, renderTextLayer, type LoadedPdf } from "./pdfjs";
import {
  displayToPdf,
  fitScale,
  pdfToDisplay,
  rotatedPageSize,
  type Size,
} from "../workspace/geometry";

type SelectionRect = { x: number; y: number; width: number; height: number };
type SelectionAction = {
  rects: SelectionRect[];
  anchor: { x: number; y: number };
  text: string;
};

type Props = {
  doc: DocumentMeta;
  getBytes: (docId: string) => Promise<Uint8Array>;
  page: number;
  scale: number;
  zoomMode: "custom" | "fit-width" | "fit-page";
  rotation: number;
  activeTool: Tool;
  annotations: Annotation[];
  color: string;
  highlightColor: string;
  strokeWidth: number;
  opacity: number;
  isActive: boolean;
  syncScroll: boolean;
  searchQuery?: string;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onAnnotationCreate: (annotation: Annotation) => void;
  onAnnotationUpdate: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
  onActivate: () => void;
  onOpenNoteForAnnotation: (annotation: Annotation) => void;
  onQuoteSelection?: (text: string, pageIndex: number) => void;
  onTextReady?: (docId: string, pageIndex: number) => void;
};

type TextEntry = { kind: "text" | "note"; point: Point } | null;

export function DocumentSurface({
  doc,
  getBytes,
  page,
  scale,
  zoomMode,
  rotation,
  activeTool,
  annotations,
  color,
  highlightColor,
  strokeWidth,
  opacity,
  isActive,
  syncScroll,
  searchQuery = "",
  onPageChange,
  onScaleChange,
  onAnnotationCreate,
  onAnnotationUpdate,
  onAnnotationDelete,
  onActivate,
  onOpenNoteForAnnotation,
  onQuoteSelection,
  onTextReady,
}: Props) {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<Size | null>(null);
  const [pageReady, setPageReady] = useState(false);
  const [textLayerReady, setTextLayerReady] = useState(false);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEntry, setTextEntry] = useState<TextEntry>(null);
  const [textValue, setTextValue] = useState("");
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const cancelTextLayer = useRef<(() => void) | null>(null);
  const renderGeneration = useRef(0);
  const cancelRender = useRef<(() => void) | null>(null);
  const syncingRef = useRef(false);
  const wheelAccum = useRef(0);
  const wheelLockUntil = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setPageReady(false);
    setPageSize(null);
    loadPdf(doc.id, () => getBytes(doc.id), { retainBytes: true, label: doc.name })
      .then((loadedPdf) => {
        if (!cancelled) setLoaded(loadedPdf);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "The document could not be opened.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, getBytes]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    setPageReady(false);
    setTextLayerReady(false);
    cancelRender.current?.();
    cancelTextLayer.current?.();
    setSelectionAction(null);
    if (textLayerRef.current) textLayerRef.current.replaceChildren();
    const generation = ++renderGeneration.current;
    loaded.pdf
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled || generation !== renderGeneration.current) return;
        const size = getPageSize(pdfPage, 0);
        setPageSize(size);
        const display = rotatedPageSize(size, rotation);
        const effectiveScale =
          zoomMode === "custom" || viewport.width === 0
            ? scale
            : fitScale(viewport, display, zoomMode, 56);
        if (zoomMode !== "custom" && Math.abs(effectiveScale - scale) > 0.002) {
          onScaleChange(effectiveScale);
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        await renderPageToCanvas(pdfPage, canvas, effectiveScale, rotation, (cancel) => {
          cancelRender.current = cancel;
        });
        if (!cancelled && generation === renderGeneration.current) {
          setPageReady(true);
          if (textLayerRef.current) {
            try {
              cancelTextLayer.current = await renderTextLayer(
                pdfPage,
                textLayerRef.current,
                effectiveScale,
                rotation,
              );
              if (!cancelled && generation === renderGeneration.current) setTextLayerReady(true);
            } catch {
              // Text selection is an enhancement; a failed text layer must not blank the page.
            }
          }
        }
      })
      .catch((renderError: unknown) => {
        const name = renderError instanceof Error ? renderError.name : "";
        if (cancelled || name === "RenderingCancelledException") return;
        setError(renderError instanceof Error ? renderError.message : "Page rendering failed.");
      });
    return () => {
      cancelled = true;
      cancelRender.current?.();
      cancelTextLayer.current?.();
      cancelTextLayer.current = null;
    };
  }, [loaded, page, scale, rotation, zoomMode, viewport.width, viewport.height, doc.id, onScaleChange]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    element.scrollTop = 0;
    setSelectionAction(null);
  }, [page, doc.id]);

  useEffect(() => {
    if (!syncScroll) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ratio: number; paneDocId: string }>).detail;
      if (!detail || detail.paneDocId === doc.id) return;
      const element = scrollerRef.current;
      if (!element || syncingRef.current) return;
      syncingRef.current = true;
      element.scrollTop = detail.ratio * Math.max(0, element.scrollHeight - element.clientHeight);
      window.requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    };
    window.addEventListener("pdfreader:scroll-sync", handler);
    return () => window.removeEventListener("pdfreader:scroll-sync", handler);
  }, [syncScroll, doc.id]);

  useEffect(() => {
    if (!isActive) {
      setSelectedId(null);
      setTextEntry(null);
      setSelectionAction(null);
    }
  }, [isActive]);

  useEffect(() => {
    if (activeTool !== "select") setSelectionAction(null);
  }, [activeTool]);

  useEffect(() => {
    const container = textLayerRef.current;
    if (!container || !textLayerReady) return;
    const needle = searchQuery.trim().toLowerCase();
    for (const span of container.querySelectorAll<HTMLElement>("span")) {
      const matches = needle.length > 1 && span.textContent?.toLowerCase().includes(needle);
      span.classList.toggle("search-hit", Boolean(matches));
    }
  }, [searchQuery, textLayerReady, page]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return;
      if (event.key === "Escape") {
        if (textEntry) {
          setTextEntry(null);
          return;
        }
        setSelectedId(null);
        return;
      }
      if (event.key === "Delete" && selectedId) {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
        event.preventDefault();
        onAnnotationDelete(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isActive, selectedId, textEntry, onAnnotationDelete]);

  const requestText = useCallback((kind: "text" | "note", point: Point) => {
    setTextEntry({ kind, point });
    setTextValue("");
  }, []);

  const commitTextEntry = () => {
    if (!textEntry) return;
    const value = textValue.trim();
    setTextEntry(null);
    setTextValue("");
    if (!value) return;
    const annotation = createAnnotation({
      docId: doc.id,
      pageIndex: page - 1,
      kind: textEntry.kind,
      color,
      opacity,
      strokeWidth: textEntry.kind === "note" ? 2 : strokeWidth,
      points: [textEntry.point],
      text: value,
      fontSize: textEntry.kind === "text" ? Math.max(10, strokeWidth * 4) : undefined,
    });
    onAnnotationCreate(annotation);
    setSelectedId(annotation.id);
  };

  if (error) {
    return (
      <div className="viewer-stage">
        <div className="empty-state" role="alert">
          <p><strong>The document could not be opened.</strong></p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const effectiveSize = pageSize ?? { width: 595.28, height: 841.89 };
  const display = rotatedPageSize(effectiveSize, rotation);
  const effectiveScale =
    zoomMode === "custom" || viewport.width === 0
      ? scale
      : fitScale(viewport, display, zoomMode, 56);
  const cssWidth = display.width * effectiveScale;
  const cssHeight = display.height * effectiveScale;
  const pageAnnotations = annotations.filter(
    (annotation) => annotation.docId === doc.id && annotation.pageIndex === page - 1,
  );

  const entryDisplay = textEntry ? pdfToDisplay(textEntry.point, effectiveSize, effectiveScale, rotation) : null;

  const captureTextSelection = () => {
    if (activeTool !== "select") return;
    const container = textLayerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionAction(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectionAction(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setSelectionAction(null);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 2 && rect.height > 2)
      .map((rect) => ({
        x: rect.left - containerRect.left,
        y: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height,
      }));
    if (rects.length === 0) {
      setSelectionAction(null);
      return;
    }
    const first = rects[0];
    setSelectionAction({
      rects,
      anchor: { x: Math.min(cssWidth - 220, Math.max(4, first.x)), y: Math.max(4, first.y - 38) },
      text,
    });
  };

  const applySelectionHighlight = () => {
    if (!selectionAction || !pageSize) return;
    for (const rect of selectionAction.rects) {
      const topLeft = displayToPdf(
        { x: rect.x, y: rect.y },
        pageSize,
        effectiveScale,
        rotation,
      );
      const bottomRight = displayToPdf(
        { x: rect.x + rect.width, y: rect.y + rect.height },
        pageSize,
        effectiveScale,
        rotation,
      );
      const annotation = createAnnotation({
        docId: doc.id,
        pageIndex: page - 1,
        kind: "highlight",
        color: highlightColor,
        opacity: 0.55,
        strokeWidth: 0,
        points: [topLeft, bottomRight],
      });
      onAnnotationCreate(annotation);
    }
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
  };

  const quoteSelection = () => {
    if (!selectionAction || !onQuoteSelection) return;
    onQuoteSelection(
      selectionAction.text.replace(/\s+/g, " ").trim(),
      page - 1,
    );
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
  };

  return (
    <div className="viewer-stage" onMouseDown={onActivate} onFocus={onActivate}>
      <div
        className="viewer-scroller"
        ref={scrollerRef}
        tabIndex={0}
        role="region"
        aria-label={`${doc.name}, page ${page} of ${doc.pageCount}`}
        onScroll={(event) => {
          if (!syncScroll) return;
          const target = event.currentTarget;
          if (syncingRef.current) return;
          const ratio = target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight);
          window.dispatchEvent(new CustomEvent("pdfreader:scroll-sync", { detail: { ratio, paneDocId: doc.id } }));
        }}
        onWheel={(event) => {
          if (Date.now() < wheelLockUntil.current) return;
          const element = event.currentTarget;
          const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
          const atTop = element.scrollTop <= 1;
          const direction = Math.sign(event.deltaY);
          if ((direction > 0 && atBottom && page < doc.pageCount) || (direction < 0 && atTop && page > 1)) {
            wheelAccum.current += event.deltaY;
            if (Math.abs(wheelAccum.current) >= 90) {
              wheelAccum.current = 0;
              wheelLockUntil.current = Date.now() + 320;
              onPageChange(direction > 0 ? page + 1 : page - 1);
            }
          }
        }}
        onClick={onActivate}
      >
        <div className="page-stack">
          <div className="page-shell" style={{ width: cssWidth, height: cssHeight }} data-page={page}>
            {!pageReady && (
              <div className="page-loading" role="status" aria-label="Rendering page">
                <span className="visually-hidden">Rendering page {page}</span>
              </div>
            )}
            <canvas ref={canvasRef} className="page-canvas" aria-hidden="true" />
            <div
              ref={textLayerRef}
              className="page-text-layer"
              style={{ ["--total-scale-factor" as string]: String(effectiveScale) } as React.CSSProperties}
              role="document"
              aria-label={`Selectable text, page ${page}`}
              onMouseUp={captureTextSelection}
            />
            {selectionAction && (
              <div
                className="selection-toolbar"
                style={{ left: selectionAction.anchor.x, top: selectionAction.anchor.y }}
                role="toolbar"
                aria-label="Text selection actions"
              >
                <button className="selection-action" onClick={applySelectionHighlight}>
                  <Highlighter size={13} style={{ color: highlightColor }} />
                  Highlight
                </button>
                {onQuoteSelection && (
                  <button className="selection-action" onClick={quoteSelection}>
                    <StickyNote size={13} />
                    Quote in note
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="Dismiss selection actions"
                  onClick={() => {
                    setSelectionAction(null);
                    window.getSelection()?.removeAllRanges();
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {pageReady && (
              <AnnotationLayer
                docId={doc.id}
                pageIndex={page - 1}
                page={effectiveSize}
                display={{ width: cssWidth, height: cssHeight }}
                scale={effectiveScale}
                rotation={rotation}
                annotations={pageAnnotations}
                tool={activeTool}
                color={color}
                strokeWidth={strokeWidth}
                opacity={opacity}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreate={onAnnotationCreate}
                onUpdate={onAnnotationUpdate}
                onDelete={onAnnotationDelete}
                onOpenNote={onOpenNoteForAnnotation}
                onRequestText={requestText}
              />
            )}
            {textEntry && entryDisplay && (
              <form
                className="text-entry"
                style={{
                  left: Math.min(Math.max(0, entryDisplay.x), Math.max(0, cssWidth - 220)),
                  top: Math.min(Math.max(0, entryDisplay.y), Math.max(0, cssHeight - 130)),
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  commitTextEntry();
                }}
              >
                <label className="visually-hidden" htmlFor="annotation-text">
                  {textEntry.kind === "note" ? "Note text" : "Text annotation"}
                </label>
                <textarea
                  id="annotation-text"
                  autoFocus
                  className="note-editor"
                  rows={textEntry.kind === "note" ? 4 : 2}
                  placeholder={textEntry.kind === "note" ? "Margin note…" : "Text to place…"}
                  value={textValue}
                  onChange={(event) => setTextValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      commitTextEntry();
                    }
                  }}
                />
                <div className="text-entry-actions">
                  <button type="button" className="button-secondary" onClick={() => setTextEntry(null)}>Cancel</button>
                  <button type="submit" className="button-primary">Add</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
