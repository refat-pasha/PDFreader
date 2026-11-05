import { MessageSquare, Trash2, X } from "lucide-react";
import type { Annotation } from "../../types";
import { useWorkspace, activeDocumentMeta } from "../workspace/store";

type Props = {
  annotations: Annotation[];
  onJump: (annotation: Annotation) => void;
  onClose: () => void;
};

const kindLabels: Record<string, string> = {
  pen: "Pen",
  highlighter: "Highlight",
  highlight: "Text highlight",
  rect: "Rectangle",
  ellipse: "Ellipse",
  arrow: "Arrow",
  text: "Text",
  note: "Note",
  image: "Image",
};

export function AnnotationPanel({ annotations, onJump, onClose }: Props) {
  const updateAnnotation = useWorkspace((state) => state.updateAnnotation);
  const deleteAnnotation = useWorkspace((state) => state.deleteAnnotation);
  const doc = useWorkspace((state) => activeDocumentMeta(state));
  const activePage = useWorkspace(
    (state) => state.panes.find((pane) => pane.id === state.activePaneId)?.view.page ?? 1,
  );
  const docAnnotations = doc
    ? annotations
        .filter((annotation) => annotation.docId === doc.id)
        .sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt)
    : [];

  return (
    <aside className="annotation-panel" aria-label="Annotations">
      <div className="panel-header">
        <span className="panel-title">MARKUP</span>
        <div style={{ display: "flex", gap: 2 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", alignSelf: "center" }}>
            {docAnnotations.length}
          </span>
          <button className="icon-button" aria-label="Close annotations" onClick={onClose}><X size={15} /></button>
        </div>
      </div>
      <div className="panel-body">
        {docAnnotations.length === 0 ? (
          <div className="empty-state">
            <MessageSquare size={22} />
            <p>No markup yet. Choose a drawing tool in the toolbar, then draw on the page.</p>
          </div>
        ) : (
          docAnnotations.map((annotation) => (
            <article
              key={annotation.id}
              className="annotation-card"
              data-active-page={annotation.pageIndex + 1 === activePage ? "true" : undefined}
              onClick={() => onJump(annotation)}
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter") onJump(annotation); }}
              role="button"
              aria-label={`${kindLabels[annotation.kind] ?? annotation.kind} on page ${annotation.pageIndex + 1}`}
            >
              <div className="annotation-kind">
                <span className="annotation-kind-dot" style={{ background: annotation.color }} />
                {kindLabels[annotation.kind] ?? annotation.kind}
                <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 10 }}>
                  p.{annotation.pageIndex + 1}
                </span>
              </div>
              <div className="annotation-meta">
                {new Date(annotation.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
              {annotation.kind === "text" || annotation.text ? (
                <textarea
                  aria-label="Annotation comment"
                  placeholder="Add a comment…"
                  value={annotation.text ?? ""}
                  onChange={(event) => updateAnnotation(annotation.id, { text: event.target.value })}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : (
                <div className="annotation-meta" style={{ marginTop: 6 }}>Double-click on the page to add a comment after saving.</div>
              )}
              <div className="card-actions">
                <button className="icon-button" aria-label="Delete annotation" title="Delete annotation" onClick={(event) => { event.stopPropagation(); deleteAnnotation(annotation.id); }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
