import { Fragment, useEffect, useRef, useState } from "react";
import type { Annotation } from "../../types";
import type { WorkspaceState } from "./store";
import { Pane } from "./Pane";

type Props = {
  state: WorkspaceState;
  getBytes: (docId: string) => Promise<Uint8Array>;
  searchQuery: string;
  onOpen: () => void;
  onSave: () => void;
  onExport: () => void;
  onPrint: () => void;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onInsertImage: () => void;
  onOpenNoteForAnnotation: (annotation: Annotation) => void;
  onQuoteSelection: (text: string, pageIndex: number) => void;
};

export function Workspace({
  state,
  getBytes,
  searchQuery,
  onOpen,
  onSave,
  onExport,
  onPrint,
  onToggleSidebar,
  onOpenSearch,
  onInsertImage,
  onOpenNoteForAnnotation,
  onQuoteSelection,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const dragRef = useRef<{
    leftId: string;
    rightId: string;
    startX: number;
    leftWeight: number;
    rightWeight: number;
  } | null>(null);

  const paneIds = state.panes.map((pane) => pane.id).join("|");
  useEffect(() => {
    setWeights((current) => {
      const next: Record<string, number> = {};
      for (const pane of state.panes) next[pane.id] = current[pane.id] ?? 1;
      return next;
    });
  }, [paneIds]);

  const weightOf = (id: string) => weights[id] ?? 1;

  const beginResize = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    const left = state.panes[index];
    const right = state.panes[index + 1];
    if (!left || !right) return;
    event.preventDefault();
    dragRef.current = {
      leftId: left.id,
      rightId: right.id,
      startX: event.clientX,
      leftWeight: weightOf(left.id),
      rightWeight: weightOf(right.id),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const width = containerRef.current?.clientWidth ?? 1;
    const pairTotal = drag.leftWeight + drag.rightWeight;
    const delta = ((event.clientX - drag.startX) / Math.max(1, width)) * pairTotal;
    const min = pairTotal * 0.15;
    const nextLeft = Math.min(pairTotal - min, Math.max(min, drag.leftWeight + delta));
    setWeights((current) => ({
      ...current,
      [drag.leftId]: nextLeft,
      [drag.rightId]: pairTotal - nextLeft,
    }));
  };

  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const nudgeResize = (index: number, direction: -1 | 1) => {
    const left = state.panes[index];
    const right = state.panes[index + 1];
    if (!left || !right) return;
    const total = weightOf(left.id) + weightOf(right.id);
    const min = total * 0.15;
    const nextLeft = Math.min(total - min, Math.max(min, weightOf(left.id) + direction * total * 0.05));
    setWeights((current) => ({
      ...current,
      [left.id]: nextLeft,
      [right.id]: total - nextLeft,
    }));
  };

  return (
    <div className="pane-grid" role="group" aria-label="Document panes" ref={containerRef}>
      {state.panes.map((pane, index) => {
        const doc = pane.activeDocId ? state.documents[pane.activeDocId] : undefined;
        const nextPane = state.panes[index + 1];
        return (
          <Fragment key={pane.id}>
            <div
              className="pane-wrapper"
              style={{ flexGrow: weightOf(pane.id), flexBasis: 0 }}
            >
              <Pane
                pane={pane}
                state={state}
                doc={doc}
                getBytes={getBytes}
                isActive={pane.id === state.activePaneId}
                searchQuery={searchQuery}
                onActivate={() => state.setActivePane(pane.id)}
                onSetPage={(page) => {
                  if (doc) state.setPage(pane.id, page, doc.pageCount);
                }}
                onSetZoom={(scale, mode) => state.setZoom(pane.id, scale, mode)}
                onRotate={() => state.setView(pane.id, { rotation: (pane.view.rotation + 90) % 360 })}
                onClosePane={() => state.closePane(pane.id)}
                onSplit={() => state.splitPane(pane.id)}
                onOpen={onOpen}
                onSave={onSave}
                onExport={onExport}
                onPrint={onPrint}
                onToggleSidebar={onToggleSidebar}
                onOpenSearch={onOpenSearch}
                onTool={(tool) => state.setActiveTool(tool)}
                onAnnotationCreate={(annotation) => state.addAnnotation(annotation)}
                onAnnotationUpdate={(id, patch) => state.updateAnnotation(id, patch)}
                onAnnotationDelete={(id) => state.deleteAnnotation(id)}
                onOpenNoteForAnnotation={onOpenNoteForAnnotation}
                onQuoteSelection={onQuoteSelection}
                onPaletteOpen={(open) => state.setPaletteOpen(open)}
                onToolColor={(color) => state.setToolColor(state.activeTool, color)}
                onToolWidth={(width) => state.setToolWidth(state.activeTool, width)}
                onToolOpacity={(opacity) => state.setToolOpacity(opacity)}
                onInsertImage={onInsertImage}
              />
            </div>
            {nextPane && (
              <div
                className="pane-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize panes ${index + 1} and ${index + 2}`}
                aria-valuemin={15}
                aria-valuemax={85}
                aria-valuenow={Math.round((weightOf(pane.id) / (weightOf(pane.id) + weightOf(nextPane.id))) * 100)}
                tabIndex={0}
                onPointerDown={(event) => beginResize(index, event)}
                onPointerMove={moveResize}
                onPointerUp={finishResize}
                onPointerCancel={finishResize}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    nudgeResize(index, -1);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    nudgeResize(index, 1);
                  }
                }}
              >
                <span className="pane-divider-handle" aria-hidden="true" />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
