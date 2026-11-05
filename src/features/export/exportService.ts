import type { Annotation, DocumentMeta, ExportOptions } from "../../types";
import { loadPdf, renderPageToCanvas } from "../viewer/pdfjs";
import { parsePageRange } from "../annotate/model";
import { toBlobPart } from "../../app/fileService";
import { isDesktop } from "../../app/fileService";

export type ExportResult = {
  blob: Blob;
  filename: string;
  warnings: string[];
};

type ExportInput = {
  doc: DocumentMeta;
  bytes: Uint8Array;
  annotations: Annotation[];
  options: ExportOptions;
  noteText?: string;
  onProgress?: (message: string) => void;
};

function safeBasename(name: string): string {
  return name.replace(/\.pdf$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "document";
}

async function renderPages(doc: DocumentMeta, bytes: Uint8Array, pageIndices: number[], dpi: number): Promise<Array<{ pageIndex: number; png: Uint8Array }>> {
  const loaded = await loadPdf(`export-${doc.id}-${Date.now()}`, async () => bytes);
  try {
    const scale = dpi / 72;
    const results: Array<{ pageIndex: number; png: Uint8Array }> = [];
    for (const pageIndex of pageIndices) {
      const page = await loaded.pdf.getPage(pageIndex + 1);
      const canvas = document.createElement("canvas");
      await renderPageToCanvas(page, canvas, scale, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`Could not render page ${pageIndex + 1}.`);
      results.push({ pageIndex, png: new Uint8Array(await blob.arrayBuffer()) });
    }
    return results;
  } finally {
    await loaded.cleanup();
  }
}

async function renderAllPages(docLabel: string, bytes: Uint8Array, dpi: number): Promise<Array<{ pageIndex: number; png: Uint8Array }>> {
  const loaded = await loadPdf(`export-all-${docLabel}-${Date.now()}`, async () => bytes);
  try {
    const scale = dpi / 72;
    const results: Array<{ pageIndex: number; png: Uint8Array }> = [];
    for (let pageIndex = 0; pageIndex < loaded.pdf.numPages; pageIndex += 1) {
      const page = await loaded.pdf.getPage(pageIndex + 1);
      const canvas = document.createElement("canvas");
      await renderPageToCanvas(page, canvas, scale, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`Could not render page ${pageIndex + 1}.`);
      results.push({ pageIndex, png: new Uint8Array(await blob.arrayBuffer()) });
    }
    return results;
  } finally {
    await loaded.cleanup();
  }
}

async function extractPages(doc: DocumentMeta, bytes: Uint8Array, pageIndices: number[]) {
  const loaded = await loadPdf(`export-text-${doc.id}-${Date.now()}`, async () => bytes);
  try {
    const results: Array<{ pageIndex: number; text: string }> = [];
    for (const pageIndex of pageIndices) {
      const page = await loaded.pdf.getPage(pageIndex + 1);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item): item is typeof item & { str: string } => "str" in item && item.str.length > 0)
        .map((item) => item.str)
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      results.push({ pageIndex, text });
    }
    return results;
  } finally {
    await loaded.cleanup();
  }
}

export async function runExport({
  doc,
  bytes,
  annotations,
  options,
  noteText,
  onProgress,
}: ExportInput): Promise<ExportResult> {
  const warnings: string[] = [];
  const pageIndices = parsePageRange(options.pageRange, doc.pageCount);
  if (!pageIndices.length) throw new Error("The page range does not select any pages.");
  const base = safeBasename(doc.name);
  onProgress?.("Preparing pages…");

  if (options.format === "pdf") {
    const { exportPdf } = await import("./exportPdf");
    const output = await exportPdf({ doc, bytes, annotations, options, noteText });
    return { blob: new Blob([toBlobPart(output)], { type: "application/pdf" }), filename: `${base}-annotated.pdf`, warnings };
  }

  if (options.format === "png") {
    onProgress?.("Rendering pages…");
    const pages = await renderPages(doc, bytes, pageIndices, options.imageDpi);
    if (pages.length === 1) {
      return { blob: new Blob([toBlobPart(pages[0].png)], { type: "image/png" }), filename: `${base}-page-${pages[0].pageIndex + 1}.png`, warnings };
    }
    const JSZip = await getZipLibrary();
    const zip = new JSZip();
    for (const page of pages) zip.file(`${base}-page-${String(page.pageIndex + 1).padStart(3, "0")}.png`, page.png);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    return { blob, filename: `${base}-pages.zip`, warnings };
  }

  const textPages = await extractPages(doc, bytes, pageIndices);
  if (options.ocr && isDesktop()) {
    const emptyPages = textPages.filter((page) => page.text.length < 8);
    if (emptyPages.length > 0) {
      const { invoke } = await import("@tauri-apps/api/core");
      let ocrAvailable = false;
      try {
        const info = await invoke<{ tesseract?: boolean; windows_ocr?: boolean; ocr?: boolean }>("get_platform_info");
        ocrAvailable = Boolean(info.ocr ?? info.tesseract ?? info.windows_ocr);
      } catch {
        ocrAvailable = false;
      }
      if (!ocrAvailable) {
        warnings.push("OCR was requested, but no OCR engine is installed or available. Pages without embedded text remain empty.");
      } else {
        try {
          const loaded = await loadPdf(`ocr-${doc.id}-${Date.now()}`, async () => bytes);
          for (const emptyPage of emptyPages) {
            onProgress?.(`OCR page ${emptyPage.pageIndex + 1}…`);
            const page = await loaded.pdf.getPage(emptyPage.pageIndex + 1);
            const canvas = document.createElement("canvas");
            await renderPageToCanvas(page, canvas, 300 / 72, 0);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
            if (!blob) continue;
            const recognized = await invoke<string>("ocr_image", {
              data: Array.from(new Uint8Array(await blob.arrayBuffer())),
              language: options.ocrLanguage,
            });
            emptyPage.text = recognized;
          }
          await loaded.cleanup();
        } catch (ocrError) {
          warnings.push(`OCR could not be completed: ${ocrError instanceof Error ? ocrError.message : "unknown error"}. Embedded text was exported where available.`);
        }
      }
    }
  } else if (options.ocr) {
    warnings.push("OCR requires the desktop build with the optional OCR component. Embedded PDF text was exported.");
  }
  if (textPages.every((page) => page.text.length < 5) && !options.ocr) {
    warnings.push("This PDF appears to contain little extractable text. Enable OCR for a scanned document.");
  }

  if (options.format === "markdown") {
    const { exportMarkdown } = await import("./exportMarkdown");
    const markdown = exportMarkdown(doc, textPages, annotations, options);
    return { blob: new Blob([markdown], { type: "text/markdown;charset=utf-8" }), filename: `${base}.md`, warnings };
  }
  if (options.format === "text") {
    const { exportText } = await import("./exportMarkdown");
    const text = exportText(textPages);
    return { blob: new Blob([text], { type: "text/plain;charset=utf-8" }), filename: `${base}.txt`, warnings };
  }
  if (options.format === "doc" || options.format === "docx") {
    onProgress?.("Building Word document…");
    const { exportDocx } = await import("./exportDocx");
    let rendered: Array<{ pageIndex: number; png: Uint8Array }> = [];
    if (options.wordLayout === "visual") {
      // Render annotated pages so the visual Word copy includes the markup the
      // reader sees, not just the untouched source page.
      const { exportPdf } = await import("./exportPdf");
      const flattened = await exportPdf({
        doc,
        bytes,
        annotations,
        options: { ...options, format: "pdf", flattenAnnotations: true, includeAnnotationSummary: false },
        noteText: undefined,
      });
      rendered = await renderAllPages(doc.id, flattened, Math.min(220, Math.max(120, options.imageDpi)));
    }
    const docx = await exportDocx({ doc, options, pages: rendered, textPages, annotations, noteText });
    if (options.format === "doc" && isDesktop()) {
      try {
        onProgress?.("Converting to Word 97…");
        const { invoke } = await import("@tauri-apps/api/core");
        const converted = await invoke<number[]>("convert_docx_to_doc", {
          data: Array.from(docx),
          filename: `${base}.docx`,
        });
        return {
          blob: new Blob([toBlobPart(new Uint8Array(converted))], { type: "application/msword" }),
          filename: `${base}.doc`,
          warnings,
        };
      } catch (conversionError) {
        warnings.push(
          `Word 97 conversion was unavailable (${conversionError instanceof Error ? conversionError.message : "LibreOffice is not installed"}). A DOCX file was created instead.`,
        );
      }
    } else if (options.format === "doc") {
      warnings.push("Legacy .doc requires the desktop app with an optional LibreOffice conversion pack. A DOCX file was created instead.");
    }
    return { blob: new Blob([toBlobPart(docx)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), filename: `${base}.docx`, warnings };
  }
  throw new Error(`Unsupported export format: ${options.format}`);
}

type ZipLike = {
  file: (name: string, data: Uint8Array) => void;
  generateAsync: (options: { type: "blob"; compression: "DEFLATE" }) => Promise<Blob>;
};

async function getZipLibrary(): Promise<new () => ZipLike> {
  // Avoid pulling a ZIP library into the viewer bundle; load it only for multi-page export.
  const moduleName = "jszip";
  try {
    const mod = await import(/* @vite-ignore */ moduleName);
    return mod.default ?? mod;
  } catch {
    throw new Error("Multi-page image export requires the optional JSZip dependency. Export a single page or reinstall the complete build.");
  }
}
