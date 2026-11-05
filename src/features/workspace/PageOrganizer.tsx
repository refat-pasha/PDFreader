import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import {
  ArrowDown,
  ArrowUp,
  FileOutput,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useWorkspace, activeDocumentMeta } from "../workspace/store";
import { getDocumentBytes } from "../../app/fileService";
import { useUi } from "../shell/uiStore";
import { useModalFocus } from "../shell/useModalFocus";
import { applyPageEdits } from "./pageOps";

type PageItem = { sourceIndex: number; rotation: number };

type Props = {
  onApply: (bytes: Uint8Array, name: string) => Promise<void>;
};

export function PageOrganizer({ onApply }: Props) {
  const doc = useWorkspace((state) => activeDocumentMeta(state));
  const close = useUi((state) => state.closeModal);
  const toast = useWorkspace((state) => state.toast);
  const [pages, setPages] = useState<PageItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus<HTMLDivElement>(close);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!doc) return;
      try {
        const bytes = await getDocumentBytes(doc.id);
        const pdf = await PDFDocument.load(bytes);
        if (!cancelled) {
          setPages(
            Array.from({ length: pdf.getPageCount() }, (_, index) => ({ sourceIndex: index, rotation: 0 })),
          );
        }
      } catch (error) {
        if (!cancelled) {
          toast(error instanceof Error ? error.message : "The page structure could not be read.", "error");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [doc?.id]);

  if (!doc) return null;

  const items = pages ?? Array.from({ length: doc.pageCount }, (_, index) => ({ sourceIndex: index, rotation: 0 }));

  const move = (index: number, direction: -1 | 1) => {
    setPages((current) => {
      const copy = [...(current ?? items)];
      const target = index + direction;
      if (target < 0 || target >= copy.length) return copy;
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const rotate = (index: number) => {
    setPages((current) => {
      const copy = [...(current ?? items)];
      copy[index] = { ...copy[index], rotation: (copy[index].rotation + 90) % 360 };
      return copy;
    });
  };

  const remove = (index: number) => {
    if (items.length <= 1) {
      toast("A PDF must keep at least one page.", "info");
      return;
    }
    setPages((current) => [...(current ?? items)].filter((_, itemIndex) => itemIndex !== index));
  };

  const apply = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const bytes = await getDocumentBytes(doc.id);
      const outputBytes = await applyPageEdits(
        bytes,
        items.map((item) => ({ sourceIndex: item.sourceIndex, rotation: item.rotation })),
        doc.name.replace(/\.pdf$/i, ""),
      );
      await onApply(outputBytes, doc.name.replace(/\.pdf$/i, " (edited).pdf"));
      close();
    } catch (error) {
      toast(error instanceof Error ? error.message : "The page changes could not be applied.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <div className="modal organizer-modal" role="dialog" aria-modal="true" aria-labelledby="organizer-title" ref={dialogRef} tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="organizer-title">Organize pages</h2>
            <p className="modal-description">
              Reorder, rotate, or remove pages. Applying creates a new document; the original file stays unchanged.
            </p>
          </div>
          <button className="icon-button" aria-label="Close page organizer" onClick={close} disabled={busy}>
            <X size={17} />
          </button>
        </div>
        <div className="modal-content">
          <ol className="organizer-list" aria-label="Page order">
            {items.map((item, index) => (
              <li key={`${item.sourceIndex}-${index}`} className="organizer-row">
                <span className="organizer-number">{index + 1}</span>
                <span className="organizer-page">Page {item.sourceIndex + 1}</span>
                <span className="organizer-meta">{item.rotation ? `${item.rotation}°` : "upright"}</span>
                <button className="icon-button" aria-label={`Move page ${index + 1} up`} title="Move up" onClick={() => move(index, -1)} disabled={index === 0}>
                  <ArrowUp size={14} />
                </button>
                <button className="icon-button" aria-label={`Move page ${index + 1} down`} title="Move down" onClick={() => move(index, 1)} disabled={index === items.length - 1}>
                  <ArrowDown size={14} />
                </button>
                <button className="icon-button" aria-label={`Rotate page ${index + 1}`} title="Rotate 90°" onClick={() => rotate(index)}>
                  <RotateCw size={14} />
                </button>
                <button className="icon-button" aria-label={`Remove page ${index + 1}`} title="Remove page" onClick={() => remove(index)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="modal-footer">
          <span className="organizer-footer-note">{items.length} of {doc.pageCount} pages</span>
          <button className="button-secondary" onClick={close} disabled={busy}>Cancel</button>
          <button className="button-primary" onClick={() => void apply()} disabled={busy}>
            <FileOutput size={14} /> {busy ? "Applying…" : "Create edited copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
