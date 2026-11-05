import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  Eraser,
  Highlighter,
  ImagePlus,
  Menu,
  MousePointer2,
  PenLine,
  Printer,
  Redo2,
  RotateCw,
  Search,
  Square,
  StickyNote,
  TextCursorInput,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect } from "react";
import type { Annotation, DocumentMeta, Pane as PaneType, Tool } from "../../types";
import { AnnotationPalette } from "../annotate/AnnotationPalette";
import { DocumentSurface } from "../viewer/DocumentSurface";
import { formatZoom } from "./geometry";
import type { WorkspaceState } from "./store";

type Props = {
  pane: PaneType;
  state: WorkspaceState;
  doc: DocumentMeta | undefined;
  getBytes: (docId: string) => Promise<Uint8Array>;
  isActive: boolean;
  searchQuery?: string;
  onActivate: () => void;
  onSetPage: (page: number) => void;
  onSetZoom: (scale: number, mode?: "custom" | "fit-width" | "fit-page") => void;
  onRotate: () => void;
  onClosePane: () => void;
  onSplit: () => void;
  onOpen: () => void;
  onSave: () => void;
  onExport: () => void;
  onPrint: () => void;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onTool: (tool: Tool) => void;
  onAnnotationCreate: (annotation: Annotation) => void;
  onAnnotationUpdate: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
  onOpenNoteForAnnotation: (annotation: Annotation) => void;
  onQuoteSelection: (text: string, pageIndex: number) => void;
  onPaletteOpen: (open: boolean) => void;
  onToolColor: (color: string) => void;
  onToolWidth: (width: number) => void;
  onToolOpacity: (opacity: number) => void;
  onInsertImage: () => void;
};

function ToolButton({
  label,
  shortcut,
  active,
  onClick,
  children,
  color,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      className="tool-button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      {color && <span className="color-indicator" style={{ background: color }} />}
    </button>
  );
}

export function Pane({
  pane,
  state,
  doc,
  getBytes,
  isActive,
  searchQuery,
  onActivate,
  onSetPage,
  onSetZoom,
  onRotate,
  onClosePane,
  onSplit,
  onOpen,
  onSave,
  onExport,
  onPrint,
  onToggleSidebar,
  onOpenSearch,
  onTool,
  onAnnotationCreate,
  onAnnotationUpdate,
  onAnnotationDelete,
  onOpenNoteForAnnotation,
  onQuoteSelection,
  onPaletteOpen,
  onToolColor,
  onToolWidth,
  onToolOpacity,
  onInsertImage,
}: Props) {
  const tool = state.activeTool;
  const color = state.toolColors[tool] ?? "#111111";
  const strokeWidth = state.toolWidths[tool] ?? 2;
  const paletteVisible = isActive && state.paletteOpen && (tool === "pen" || tool === "highlighter");
  const [pageInput, setPageInput] = [pane.view.page, onSetPage];

  useEffect(() => {
    if (!isActive) return;
    // Keep the active pane's page input in sync with keyboard navigation.
    const input = document.getElementById(`pane-page-${pane.id}`) as HTMLInputElement | null;
    if (input && document.activeElement !== input) input.value = String(pageInput);
  }, [isActive, pageInput, pane.id]);

  return (
    <section
      className={`pane${isActive ? " active" : ""}`}
      aria-label={`${doc?.name ?? "Empty pane"}`}
      onMouseDown={onActivate}
      onFocusCapture={onActivate}
    >
      <div className="pane-toolbar" role="toolbar" aria-label="Document tools">
        <button className="icon-button" aria-label="Navigation panels" title="Navigation panels" onClick={onToggleSidebar}>
          <Menu size={16} />
        </button>
        <span className="pane-title" title={doc?.name}>{doc?.name ?? "No document"}</span>
        {doc && (
          <>
            <div className="pane-navigation">
              <input
                id={`pane-page-${pane.id}`}
                className="pane-page-box"
                aria-label="Page number"
                defaultValue={pane.view.page}
                inputMode="numeric"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const parsed = Number.parseInt(event.currentTarget.value, 10);
                    if (Number.isFinite(parsed)) onSetPage(Math.min(doc.pageCount, Math.max(1, parsed)));
                    event.currentTarget.blur();
                  }
                }}
                onBlur={(event) => {
                  const parsed = Number.parseInt(event.currentTarget.value, 10);
                  if (Number.isFinite(parsed)) onSetPage(Math.min(doc.pageCount, Math.max(1, parsed)));
                }}
              />
              <span className="pane-page-total">/ {doc.pageCount}</span>
              <button className="icon-button" aria-label="Previous page" title="Previous page (PageUp)" disabled={pane.view.page <= 1} onClick={() => onSetPage(pane.view.page - 1)}>
                <ChevronLeft size={15} />
              </button>
              <button className="icon-button" aria-label="Next page" title="Next page (PageDown)" disabled={pane.view.page >= doc.pageCount} onClick={() => onSetPage(pane.view.page + 1)}>
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="tool-sep" />
            <button className="icon-button" aria-label="Zoom out" title="Zoom out (Ctrl+-)" onClick={() => onSetZoom(pane.view.scale / 1.2)}>
              <ZoomOut size={15} />
            </button>
            <span className="zoom-readout">{formatZoom(pane.view.scale)}</span>
            <button className="icon-button" aria-label="Zoom in" title="Zoom in (Ctrl++)" onClick={() => onSetZoom(pane.view.scale * 1.2)}>
              <ZoomIn size={15} />
            </button>
            <button className="icon-button" aria-label="Fit width" title="Fit width (Ctrl+1)" aria-pressed={pane.view.zoomMode === "fit-width"} onClick={() => onSetZoom(1, "fit-width")}>
              <Columns2 size={15} />
            </button>
            <button className="icon-button" aria-label="Rotate page view" title="Rotate page view" onClick={onRotate}>
              <RotateCw size={15} />
            </button>
            <div className="tool-sep" />
            <div className="tool-group" aria-label="Text and drawing tools">
              <ToolButton label="Select" shortcut="V" active={tool === "select"} onClick={() => onTool("select")}>
                <MousePointer2 size={15} />
              </ToolButton>
              <ToolButton label="Pen" shortcut="D" active={tool === "pen"} onClick={() => { onTool("pen"); onPaletteOpen(true); }} color={state.toolColors.pen}>
                <PenLine size={15} />
              </ToolButton>
              <ToolButton label="Highlighter" shortcut="H" active={tool === "highlighter"} onClick={() => { onTool("highlighter"); onPaletteOpen(true); }} color={state.toolColors.highlighter}>
                <Highlighter size={15} />
              </ToolButton>
              <ToolButton label="Free text" shortcut="T" active={tool === "text"} onClick={() => onTool("text")}>
                <TextCursorInput size={15} />
              </ToolButton>
              <ToolButton label="Note" shortcut="N" active={tool === "note"} onClick={() => onTool("note")}>
                <StickyNote size={15} />
              </ToolButton>
              <ToolButton
                label={tool === "ellipse" || tool === "arrow" ? `Shape (${tool})` : "Shape (rectangle)"}
                active={tool === "rect" || tool === "ellipse" || tool === "arrow"}
                onClick={() => onTool(tool === "rect" ? "ellipse" : tool === "ellipse" ? "arrow" : "rect")}
                color={state.toolColors.rect}
              >
                <Square size={15} />
              </ToolButton>
              <ToolButton label="Eraser" shortcut="E" active={tool === "eraser"} onClick={() => onTool("eraser")}>
                <Eraser size={15} />
              </ToolButton>
            </div>
            <div className="tool-sep" />
            <button className="icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={() => state.undo(doc.id)}>
              <Undo2 size={15} />
            </button>
            <button className="icon-button" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={() => state.redoAction(doc.id)}>
              <Redo2 size={15} />
            </button>
          </>
        )}
        <div className="pane-spacer" />
        <button className="icon-button" aria-label="Search" title="Search (Ctrl+F)" onClick={onOpenSearch} disabled={!doc}>
          <Search size={15} />
        </button>
        <button className="icon-button" aria-label="Insert image" title="Insert reference image" onClick={onInsertImage} disabled={!doc}>
          <ImagePlus size={15} />
        </button>
        <button className="icon-button" aria-label="Save" title="Save (Ctrl+S)" onClick={onSave} disabled={!doc}>
          <Download size={15} />
        </button>
        <button className="icon-button" aria-label="Print" title="Print (Ctrl+P)" onClick={onPrint} disabled={!doc}>
          <Printer size={15} />
        </button>
        <button className="icon-button" aria-label="Split pane" title="Split pane (Ctrl+\)" onClick={onSplit}>
          <Columns2 size={15} />
        </button>
        {state.panes.length > 1 && (
          <button className="icon-button" aria-label="Close pane" title="Close pane" onClick={onClosePane}>
            <X size={15} />
          </button>
        )}
      </div>
      {doc ? (
        <div style={{ position: "relative", minWidth: 0, minHeight: 0, width: "100%", height: "100%" }}>
          <DocumentSurface
            doc={doc}
            getBytes={getBytes}
            page={pane.view.page}
            scale={pane.view.scale}
            zoomMode={pane.view.zoomMode}
            rotation={pane.view.rotation}
            activeTool={tool}
            annotations={state.annotations}
            color={color}
            highlightColor={state.toolColors.highlighter ?? "#ffe45c"}
            strokeWidth={strokeWidth}
            opacity={state.toolOpacity}
            isActive={isActive}
            syncScroll={state.syncScroll}
            searchQuery={searchQuery}
            onPageChange={(page) => onSetPage(page)}
            onScaleChange={(scale) => onSetZoom(scale)}
            onAnnotationCreate={onAnnotationCreate}
            onAnnotationUpdate={(id, patch) => onAnnotationUpdate(id, patch)}
            onAnnotationDelete={(id) => onAnnotationDelete(id)}
            onActivate={onActivate}
            onOpenNoteForAnnotation={onOpenNoteForAnnotation}
            onQuoteSelection={onQuoteSelection}
          />
          {paletteVisible && (
            <AnnotationPalette
              tool={tool}
              color={color}
              width={strokeWidth}
              opacity={state.toolOpacity}
              onColor={onToolColor}
              onWidth={onToolWidth}
              onOpacity={onToolOpacity}
              onClose={() => onPaletteOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="empty-state" style={{ display: "grid", placeItems: "center" }}>
          <div>
            <p style={{ fontSize: 16, color: "var(--text)" }}>This pane is ready.</p>
            <p>Open a PDF, or drag one into the window.</p>
            <button className="button-primary" onClick={onOpen}>Open PDF</button>
          </div>
        </div>
      )}
      <span className="visually-hidden" aria-live="polite">
        {doc ? `${doc.name}, page ${pane.view.page} of ${doc.pageCount}, zoom ${formatZoom(pane.view.scale)}` : ""}
      </span>
    </section>
  );
}
