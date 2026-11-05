import { useEffect, useRef, useState } from "react";
import { loadPdf, renderPageToCanvas } from "./pdfjs";
import type { DocumentMeta } from "../../types";
import { renderNativePagePng } from "../../app/nativePdf";

type Props = {
  doc: DocumentMeta;
  getBytes: (docId: string) => Promise<Uint8Array>;
  currentPage: number;
  onPageChange: (page: number) => void;
};

function Thumbnail({
  doc,
  pageNumber,
  current,
  getBytes,
  onClick,
}: {
  doc: DocumentMeta;
  pageNumber: number;
  current: boolean;
  getBytes: (docId: string) => Promise<Uint8Array>;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = buttonRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setVisible(entry.isIntersecting);
      },
      { rootMargin: "280px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    const draw = async () => {
      // Prefer the bundled native engine in the desktop app. Browser preview
      // falls back to PDF.js, which is also used if PDFium cannot render.
      if (doc.path) {
        const png = await renderNativePagePng(doc.path, pageNumber, 170);
        if (cancelled) return;
        if (png) {
          try {
            const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
            if (cancelled) {
              bitmap.close();
              return;
            }
            const canvas = canvasRef.current;
            if (!canvas) {
              bitmap.close();
              return;
            }
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
            bitmap.close();
            return;
          } catch {
            // Fall through to PDF.js below.
          }
        }
      }
      const loaded = await loadPdf(doc.id, () => getBytes(doc.id));
      const page = await loaded.pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const targetWidth = 170;
      const scale = targetWidth / viewport.width;
      if (canvasRef.current && !cancelled) {
        await renderPageToCanvas(page, canvasRef.current, scale, 0, (cancel) => {
          cancelRender = cancel;
        });
      }
    };
    draw().catch((error: unknown) => {
      const name = error instanceof Error ? error.name : "";
      if (!cancelled && name !== "RenderingCancelledException") setFailed(true);
    });
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [visible, doc.id, doc.path, pageNumber, getBytes]);

  return (
    <button
      ref={buttonRef}
      className="thumb-button"
      aria-label={`Go to page ${pageNumber}`}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
    >
      <div className="thumb-page">
        {failed ? (
          <div className="thumb-failure">Page {pageNumber}</div>
        ) : visible ? (
          <canvas ref={canvasRef} width={170} height={240} />
        ) : (
          <div className="thumb-placeholder" aria-hidden="true">{pageNumber}</div>
        )}
      </div>
      <span className="thumb-label">
        <span>{pageNumber}</span>
        {current && <span>Reading</span>}
      </span>
    </button>
  );
}

export function ThumbnailStrip({ doc, getBytes, currentPage, onPageChange }: Props) {
  return (
    <div className="thumb-list">
      {Array.from({ length: doc.pageCount }, (_, index) => (
        <Thumbnail
          key={index}
          doc={doc}
          pageNumber={index + 1}
          current={currentPage === index + 1}
          getBytes={getBytes}
          onClick={() => onPageChange(index + 1)}
        />
      ))}
    </div>
  );
}
