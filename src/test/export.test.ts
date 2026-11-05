import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { createDemoPdf } from "../data/demo";
import { exportPdf } from "../features/export/exportPdf";
import { createAnnotation } from "../features/annotate/model";
import { exportMarkdown, exportText } from "../features/export/exportMarkdown";
import { exportDocx } from "../features/export/exportDocx";
import type { Annotation, DocumentMeta, ExportOptions } from "../types";

const doc: DocumentMeta = {
  id: "doc-1",
  name: "sample.pdf",
  pageCount: 6,
  size: 0,
  source: "demo",
  openedAt: Date.now(),
};

const options: ExportOptions = {
  format: "pdf",
  pageRange: "",
  flattenAnnotations: true,
  includeAnnotationSummary: true,
  imageDpi: 150,
  ocr: false,
  ocrLanguage: "eng",
  wordLayout: "editable",
};

function annotation(kind: Annotation["kind"], points: Annotation["points"]): Annotation {
  return createAnnotation({
    docId: doc.id,
    pageIndex: 0,
    kind,
    color: "#e84b3c",
    opacity: 0.9,
    strokeWidth: 2,
    points,
    text: kind === "text" ? "Reviewed" : "A margin note",
  });
}

describe("PDF export", () => {
  it("generates a valid multi-page demo document", async () => {
    const bytes = await createDemoPdf();
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(7);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("flattens annotations into a valid PDF and appends the notes summary", async () => {
    const bytes = await createDemoPdf();
    const annotations: Annotation[] = [
      annotation("pen", [{ x: 70, y: 600 }, { x: 200, y: 640 }]),
      annotation("rect", [{ x: 60, y: 400 }, { x: 300, y: 500 }]),
      annotation("ellipse", [{ x: 320, y: 400 }, { x: 450, y: 480 }]),
      annotation("arrow", [{ x: 70, y: 200 }, { x: 220, y: 260 }]),
      annotation("highlighter", [{ x: 80, y: 720 }, { x: 400, y: 720 }]),
      annotation("text", [{ x: 90, y: 300 }]),
      annotation("note", [{ x: 500, y: 700 }]),
    ];
    const output = await exportPdf({ doc, bytes, annotations, options, noteText: "# Reading log\n\nA note." });
    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(8);
    expect(output.byteLength).toBeGreaterThan(1000);
  });

  it("honours the page range and can omit the summary", async () => {
    const bytes = await createDemoPdf();
    const output = await exportPdf({
      doc,
      bytes,
      annotations: [],
      options: { ...options, pageRange: "2-3", includeAnnotationSummary: false },
    });
    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(2);
  });
});

describe("text exports", () => {
  const textPages = [
    { pageIndex: 0, text: "First page body." },
    { pageIndex: 1, text: "Second page body." },
  ];

  it("writes structured Markdown with page headings and annotations", () => {
    const markdown = exportMarkdown(doc, textPages, [annotation("note", [{ x: 1, y: 1 }])], options);
    expect(markdown).toContain("# sample");
    expect(markdown).toContain("## Page 1");
    expect(markdown).toContain("First page body.");
    expect(markdown).toContain("Reading notes");
  });

  it("writes plain text with page separators", () => {
    const text = exportText(textPages);
    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("Second page body.");
  });

  it("builds a valid editable DOCX package with text and no page images", async () => {
    const output = await exportDocx({
      doc,
      options: { ...options, format: "docx", wordLayout: "editable" },
      pages: [],
      textPages,
      annotations: [annotation("note", [{ x: 1, y: 1 }])],
      noteText: "# Reading log\n\nA note.",
    });
    const zip = await JSZip.loadAsync(output);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("First page body.");
    expect(documentXml).toContain("Reading notes");
    expect(documentXml).toContain("Notebook");
    expect(zip.file(/word\/media\//)).toHaveLength(0);
  });
});
