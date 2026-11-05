import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { Annotation, DocumentMeta, ExportOptions } from "../../types";
import { annotationBounds, parsePageRange } from "../annotate/model";

type ExportInput = {
  doc: DocumentMeta;
  bytes: Uint8Array;
  annotations: Annotation[];
  options: ExportOptions;
  noteText?: string;
};

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}

function splitWords(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function exportPdf({
  doc,
  bytes,
  annotations,
  options,
  noteText,
}: ExportInput): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const selectedPages = parsePageRange(options.pageRange, source.getPageCount());
  const output = await PDFDocument.create();
  output.setTitle(doc.name.replace(/\.pdf$/i, ""));
  output.setProducer("PDFreader");
  output.setCreator("PDFreader");

  const copied = await output.copyPages(source, selectedPages);
  copied.forEach((page) => output.addPage(page));
  const font = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);

  if (options.flattenAnnotations) {
    for (let outputIndex = 0; outputIndex < selectedPages.length; outputIndex += 1) {
      const sourceIndex = selectedPages[outputIndex];
      const page = output.getPage(outputIndex);
      const pageAnnotations = annotations.filter(
        (annotation) => annotation.docId === doc.id && annotation.pageIndex === sourceIndex,
      );
      for (const annotation of pageAnnotations) {
        await drawAnnotation(output, page, annotation, font);
      }
    }
  }

  if (options.includeAnnotationSummary) {
    const summaryAnnotations = annotations
      .filter((annotation) => annotation.docId === doc.id && selectedPages.includes(annotation.pageIndex))
      .sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt);
    if (summaryAnnotations.length > 0 || noteText) {
      const page = output.addPage([595.28, 841.89]);
      page.drawText("Reading notes", { x: 56, y: 772, size: 24, font: bold, color: rgb(0.1, 0.12, 0.16) });
      page.drawLine({ start: { x: 56, y: 756 }, end: { x: 539, y: 756 }, thickness: 1, color: rgb(0.82, 0.84, 0.87) });
      let y = 720;
      const writeLines = (text: string, size = 10, limit = 77) => {
        for (const line of splitWords(text, font, size, 475)) {
          if (y < 56) return false;
          page.drawText(line, { x: 56, y, size, font, color: rgb(0.16, 0.18, 0.22) });
          y -= size * 1.55;
        }
        return true;
      };
      if (noteText) {
        for (const line of noteText.split("\n")) {
          if (!writeLines(line || " ")) break;
        }
        y -= 10;
      }
      for (const annotation of summaryAnnotations) {
        const detail = annotation.text
          ? `${annotation.text}`
          : annotation.kind === "highlighter" || annotation.kind === "highlight"
            ? "Highlighted passage"
            : `${annotation.kind} annotation`;
        if (!writeLines(`p.${annotation.pageIndex + 1} · ${detail}`)) break;
      }
    }
  }

  return output.save({ useObjectStreams: true });
}

async function drawAnnotation(
  document: PDFDocument,
  page: ReturnType<PDFDocument["getPage"]>,
  annotation: Annotation,
  font: PDFFont,
): Promise<void> {
  const { width: pageWidth } = page.getSize();
  const color = hexToRgb(annotation.color);
  const rgbColor = rgb(color.r, color.g, color.b);
  const scale = 1;
  const points = annotation.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const box = annotationBounds(annotation);
  switch (annotation.kind) {
    case "pen":
    case "highlighter": {
      if (points.length < 2) return;
      for (let index = 0; index < points.length - 1; index += 1) {
        page.drawLine({
          start: points[index],
          end: points[index + 1],
          thickness: annotation.strokeWidth,
          color: rgbColor,
          opacity: annotation.kind === "highlighter" ? Math.min(0.6, annotation.opacity) : annotation.opacity,
        });
      }
      return;
    }
    case "rect":
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
        borderColor: rgbColor,
        borderWidth: annotation.strokeWidth,
        opacity: 0,
        borderOpacity: annotation.opacity,
      });
      return;
    case "highlight":
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
        color: rgbColor,
        opacity: Math.min(0.6, annotation.opacity),
      });
      return;
    case "ellipse":
      page.drawEllipse({
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        xScale: Math.max(1, box.width / 2),
        yScale: Math.max(1, box.height / 2),
        borderColor: rgbColor,
        borderWidth: annotation.strokeWidth,
        opacity: 0,
        borderOpacity: annotation.opacity,
      });
      return;
    case "arrow": {
      if (points.length < 2) return;
      const [a, b] = points;
      page.drawLine({ start: a, end: b, thickness: annotation.strokeWidth, color: rgbColor, opacity: annotation.opacity });
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 10;
      page.drawLine({
        start: b,
        end: { x: b.x - head * Math.cos(angle - Math.PI / 6), y: b.y - head * Math.sin(angle - Math.PI / 6) },
        thickness: annotation.strokeWidth,
        color: rgbColor,
        opacity: annotation.opacity,
      });
      page.drawLine({
        start: b,
        end: { x: b.x - head * Math.cos(angle + Math.PI / 6), y: b.y - head * Math.sin(angle + Math.PI / 6) },
        thickness: annotation.strokeWidth,
        color: rgbColor,
        opacity: annotation.opacity,
      });
      return;
    }
    case "text": {
      if (!annotation.text) return;
      const size = annotation.fontSize ?? 12;
      page.drawText(annotation.text, {
        x: Math.min(box.x, Math.max(0, pageWidth - 20)),
        y: Math.max(0, box.y),
        size,
        font,
        color: rgbColor,
      });
      return;
    }
    case "note": {
      page.drawCircle({ x: box.x, y: box.y, size: 9, color: rgbColor, opacity: 0.95 });
      page.drawText("i", { x: box.x - 2.2, y: box.y - 3, size: 9, font, color: rgb(1, 1, 1) });
      return;
    }
    case "image": {
      if (!annotation.imageData) return;
      const match = annotation.imageData.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
      if (!match) return;
      const binary = atob(match[2]);
      const data = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
      const embedded = match[1] === "png" ? await document.embedPng(data) : await document.embedJpg(data);
      page.drawImage(embedded, {
        x: box.x,
        y: box.y,
        width: Math.max(8, box.width),
        height: Math.max(8, box.height),
        opacity: annotation.opacity,
      });
      return;
    }
    default:
      return;
  }
}
