import { useState } from "react";
import { Download, FileImage, FileText, FileType2, Loader2, X } from "lucide-react";
import type { ExportFormat } from "../../types";
import { useWorkspace, activeDocumentMeta } from "../workspace/store";
import { getDocumentBytes, writeBlob } from "../../app/fileService";
import { runExport } from "../export/exportService";
import { useUi } from "./uiStore";
import { useModalFocus } from "./useModalFocus";

const formats: Array<{ id: ExportFormat; label: string; detail: string; icon: typeof FileText }> = [
  { id: "pdf", label: "PDF", detail: "Annotated copy", icon: FileType2 },
  { id: "docx", label: "Word", detail: "Visual working copy", icon: FileText },
  { id: "doc", label: "Word 97", detail: "Optional component", icon: FileText },
  { id: "markdown", label: "Markdown", detail: "Text and notes", icon: FileText },
  { id: "text", label: "Text", detail: "UTF-8 reading copy", icon: FileText },
  { id: "png", label: "Images", detail: "Page PNG files", icon: FileImage },
];

export function ExportDialog() {
  const close = useUi((state) => state.closeModal);
  const options = useWorkspace((state) => state.exportOptions);
  const setOptions = useWorkspace((state) => state.setExportOptions);
  const doc = useWorkspace((state) => activeDocumentMeta(state));
  const annotations = useWorkspace((state) => state.annotations);
  const notes = useWorkspace((state) => state.notes);
  const toast = useWorkspace((state) => state.toast);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const dialogRef = useModalFocus<HTMLDivElement>(close);

  const run = async () => {
    if (!doc) return;
    setBusy(true);
    setWarnings([]);
    try {
      const bytes = await getDocumentBytes(doc.id);
      const noteText = notes
        .filter((note) => !note.links.length || note.links.some((link) => link.docId === doc.id))
        .map((note) => `## ${note.title}\n\n${note.body}`)
        .join("\n\n");
      const result = await runExport({
        doc,
        bytes,
        annotations,
        options,
        noteText,
        onProgress: setProgress,
      });
      setProgress("Waiting for destination…");
      const destination = await writeBlob(result.blob, result.filename);
      if (destination) {
        setWarnings(result.warnings);
        toast(`Exported to ${destination}`, "success");
        if (!result.warnings.length) close();
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "The export could not be completed.", "error");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" ref={dialogRef} tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="export-title">Export document</h2>
            <p className="modal-description">
              {doc ? `Create a working copy of “${doc.name}”. Your original PDF is not changed.` : "Open a document first."}
            </p>
          </div>
          <button className="icon-button" aria-label="Close export dialog" onClick={close} disabled={busy}>
            <X size={17} />
          </button>
        </div>
        <div className="modal-content">
          <div className="form-row">
            <label id="format-label">Format</label>
            <div className="format-grid" role="group" aria-labelledby="format-label">
              {formats.map(({ id, label, detail, icon: Icon }) => (
                <button
                  key={id}
                  className={`format-card${options.format === id ? " selected" : ""}`}
                  aria-pressed={options.format === id}
                  onClick={() => setOptions({ format: id })}
                >
                  <Icon size={17} />
                  <span className="format-name">{label}</span>
                  <span className="format-detail">{detail}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label htmlFor="page-range">Page range</label>
              <input
                id="page-range"
                placeholder="All pages, or 1-5, 8"
                value={options.pageRange}
                onChange={(event) => setOptions({ pageRange: event.target.value })}
              />
              <span className="hint">Use commas and ranges. Leave blank for all pages.</span>
            </div>
            <div className="form-row">
              <label htmlFor="image-dpi">Image quality</label>
              <select
                id="image-dpi"
                value={options.imageDpi}
                onChange={(event) => setOptions({ imageDpi: Number(event.target.value) })}
              >
                <option value={96}>96 DPI · screen</option>
                <option value={150}>150 DPI · draft</option>
                <option value={220}>220 DPI · print copy</option>
                <option value={300}>300 DPI · archive</option>
              </select>
            </div>
          </div>
          {(options.format === "docx" || options.format === "doc") && (
            <div className="form-row">
              <label>Word output</label>
              <div className="radio-row" role="radiogroup" aria-label="Word output layout">
                <label className={`radio-card${options.wordLayout === "editable" ? " selected" : ""}`}>
                  <input
                    type="radio"
                    name="word-layout"
                    value="editable"
                    checked={options.wordLayout === "editable"}
                    onChange={() => setOptions({ wordLayout: "editable" })}
                  />
                  Editable text
                </label>
                <label className={`radio-card${options.wordLayout === "visual" ? " selected" : ""}`}>
                  <input
                    type="radio"
                    name="word-layout"
                    value="visual"
                    checked={options.wordLayout === "visual"}
                    onChange={() => setOptions({ wordLayout: "visual" })}
                  />
                  Preserve page layout
                </label>
              </div>
              <span className="hint">
                Editable text flows into Word paragraphs. Preserve layout embeds annotated page images for visual fidelity.
              </span>
            </div>
          )}
          <div className="check-row">
            <input
              id="flatten"
              type="checkbox"
              checked={options.flattenAnnotations}
              onChange={(event) => setOptions({ flattenAnnotations: event.target.checked })}
            />
            <label htmlFor="flatten">Include visible annotations in the exported pages</label>
          </div>
          <div className="check-row">
            <input
              id="summary"
              type="checkbox"
              checked={options.includeAnnotationSummary}
              onChange={(event) => setOptions({ includeAnnotationSummary: event.target.checked })}
            />
            <label htmlFor="summary">Append a reading-notes summary</label>
          </div>
          <div className="check-row">
            <input
              id="ocr"
              type="checkbox"
              checked={options.ocr}
              onChange={(event) => setOptions({ ocr: event.target.checked })}
            />
            <label htmlFor="ocr">Use OCR if the document is scanned (Windows OCR or Tesseract)</label>
          </div>
          {options.ocr && (
            <div className="form-row">
              <label htmlFor="ocr-lang">OCR language</label>
              <select id="ocr-lang" value={options.ocrLanguage} onChange={(event) => setOptions({ ocrLanguage: event.target.value })}>
                <option value="eng">English</option>
                <option value="ben">Bengali</option>
                <option value="eng+ben">English + Bengali</option>
              </select>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="export-warning" role="status">
              <strong>Export completed with notes</strong>
              <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button-secondary" onClick={close} disabled={busy}>Cancel</button>
          <button className="button-primary" onClick={run} disabled={!doc || busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {busy ? progress || "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
