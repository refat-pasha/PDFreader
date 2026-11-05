import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  PageBreak,
} from "docx";
import type { Annotation, DocumentMeta, ExportOptions } from "../../types";
import { parsePageRange } from "../annotate/model";

type PageRender = { pageIndex: number; png: Uint8Array };
type TextPage = { pageIndex: number; text: string };

type Input = {
  doc: DocumentMeta;
  options: ExportOptions;
  pages: PageRender[];
  textPages: TextPage[];
  annotations: Annotation[];
  noteText?: string;
};

export async function exportDocx(input: Input): Promise<Uint8Array> {
  const { doc, options, pages, textPages, annotations, noteText } = input;
  const children: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: doc.name.replace(/\.pdf$/i, ""),
          bold: true,
          size: 40,
          font: "Segoe UI",
        }),
      ],
      heading: HeadingLevel.TITLE,
      spacing: { after: 180 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Converted from PDF by PDFreader · ${new Date().toLocaleDateString()}`,
          color: "667085",
          size: 18,
          font: "Segoe UI",
        }),
      ],
      spacing: { after: 320 },
    }),
  ];

  if (options.wordLayout === "visual" && pages.length) {
    // Pixel-preserving layout pages make a predictable visual working copy.
    pages.forEach((page, index) => {
      if (index > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      children.push(
        new Paragraph({
          alignment: "center",
          spacing: { after: 100 },
          children: [
            new ImageRun({
              data: page.png,
              type: "png",
              transformation: { width: 595, height: 842 },
              altText: {
                title: `Page ${page.pageIndex + 1}`,
                description: `Visual page ${page.pageIndex + 1} of ${doc.name}`,
                name: `page-${page.pageIndex + 1}.png`,
              },
            } as never),
          ],
        }),
      );
    });
  } else {
    appendTextPages(children, textPages);
  }

  const selectedAnnotations = annotations.filter((annotation) => annotation.docId === doc.id);
  if (options.includeAnnotationSummary && selectedAnnotations.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Reading notes", bold: true, size: 30 })],
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
      }),
    );
    for (const annotation of selectedAnnotations.sort((a, b) => a.pageIndex - b.pageIndex)) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Page ${annotation.pageIndex + 1} · ${annotation.kind}`, bold: true, size: 21 }),
            new TextRun({
              text: annotation.text ? ` — ${annotation.text}` : "",
              size: 21,
            }),
          ],
          spacing: { after: 70 },
        }),
      );
    }
  }

  if (noteText) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Notebook", bold: true, size: 30 })],
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
      }),
    );
    for (const line of noteText.split("\n")) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 22 })] }));
    }
  }

  const document = new Document({
    creator: "PDFreader",
    title: doc.name.replace(/\.pdf$/i, ""),
    description: "PDF converted by PDFreader",
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

function appendTextPages(children: Paragraph[], textPages: TextPage[]) {
  for (const page of textPages) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Page ${page.pageIndex + 1}`, color: "667085", size: 17 })],
        spacing: { before: 220, after: 80 },
        heading: HeadingLevel.HEADING_2,
      }),
    );
    const paragraphs = page.text
      .split(/\n\s*\n|\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (paragraphs.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "No extractable text on this page.", italics: true, color: "777777" })] }));
    } else {
      for (const paragraph of paragraphs) {
        children.push(new Paragraph({ children: [new TextRun({ text: paragraph, size: 22 })], spacing: { after: 90 } }));
      }
    }
  }
}

export function selectedPageIndices(doc: DocumentMeta, options: ExportOptions): number[] {
  return parsePageRange(options.pageRange, doc.pageCount);
}
