import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const INK = rgb(0.08, 0.09, 0.11);
const MUTED = rgb(0.36, 0.39, 0.44);
const LINE = rgb(0.84, 0.85, 0.87);
const ACCENT = rgb(0.2, 0.42, 0.72);
const PALE = rgb(0.93, 0.95, 0.98);

const sections = [
  {
    title: "Reading without friction",
    kicker: "A desktop workspace for documents that deserve attention",
    body: [
      "PDFreader is a focused reading environment. Open a document, split the workspace, and keep the passage you are studying beside the notes you are building.",
      "The interface stays quiet: a compact toolbar, a page surface that behaves like paper, and controls that are always within reach of the keyboard.",
    ],
  },
  {
    title: "One page, two perspectives",
    kicker: "Split view",
    body: [
      "Open the same PDF in two panes when a figure on page 4 needs to be read against the method on page 18. Each pane keeps its own page, zoom, rotation, and scroll position.",
      "Documents are never duplicated in memory just because they are visible twice. Tabs and panes are views over a shared document session.",
    ],
  },
  {
    title: "Mark up the argument",
    kicker: "Annotation",
    body: [
      "Use the pen, highlighter, shapes, and margin notes to work through a document. The palette remembers the last size and color for each tool.",
      "Every change can be undone. Draft work is kept locally and is only written into a PDF when you explicitly save or export.",
    ],
  },
  {
    title: "From reading to writing",
    kicker: "Export",
    body: [
      "Turn a marked-up reading into an editable working document. Export to Markdown for a reading log, DOCX for a report, or a flattened PDF for sharing.",
      "Scanned documents can be passed through OCR, and conversion runs outside the reading process so a difficult document cannot interrupt your session.",
    ],
  },
  {
    title: "The keyboard is part of the page",
    kicker: "Navigation",
    body: [
      "PageUp and PageDown move between pages. Space scrolls the viewport. Ctrl+Tab switches documents, while Alt+1 through Alt+4 move focus between panes.",
      "Every toolbar action has a discoverable command, an accessible name, and a keyboard alternative.",
    ],
  },
  {
    title: "Built to recover",
    kicker: "Reliability",
    body: [
      "Saving uses a temporary file and an explicit replacement step. Draft annotations and notes survive an unexpected restart.",
      "A native crash in the document engine is contained and reported. Reading, editing, and conversion are separate responsibilities.",
    ],
  },
];

export async function createDemoPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("A quieter way to read");
  pdf.setAuthor("PDFreader");
  pdf.setSubject("Desktop PDF workspace demonstration");
  pdf.setCreator("PDFreader");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  let page = pdf.addPage([595.28, 841.89]);
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(0.975, 0.973, 0.965) });
  page.drawText("PDFreader", { x: 56, y: 735, size: 13, font: bold, color: ACCENT });
  page.drawText("A quieter\nway to read.", {
    x: 56,
    y: 640,
    size: 52,
    lineHeight: 56,
    font: bold,
    color: INK,
  });
  page.drawText("Read, mark up, compare, and carry a document into your work.", {
    x: 56,
    y: 500,
    size: 14,
    font: regular,
    color: MUTED,
  });
  page.drawLine({ start: { x: 56, y: 455 }, end: { x: 539, y: 455 }, thickness: 0.8, color: LINE });
  page.drawText("INTERACTIVE SAMPLE · 7 PAGES", { x: 56, y: 420, size: 8, font: mono, color: MUTED });
  page.drawText("Open a real PDF at any time with Ctrl+O.", { x: 56, y: 70, size: 8, font: regular, color: MUTED });
  page.drawText("01", { x: 525, y: 70, size: 8, font: mono, color: MUTED });

  for (let i = 0; i < sections.length; i += 1) {
    page = pdf.addPage([595.28, 841.89]);
    const section = sections[i];
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(0.99, 0.988, 0.98) });
    page.drawText(section.kicker.toUpperCase(), { x: 56, y: 742, size: 8, font: mono, color: ACCENT });
    page.drawText(section.title, { x: 56, y: 680, size: 30, font: bold, color: INK, maxWidth: 470 });
    page.drawLine({ start: { x: 56, y: 650 }, end: { x: 539, y: 650 }, thickness: 1, color: LINE });

    let y = 605;
    for (const paragraph of section.body) {
      const lines = wrapText(paragraph, regular, 11.5, 470);
      for (const line of lines) {
        page.drawText(line, { x: 56, y, size: 11.5, font: regular, color: rgb(0.15, 0.16, 0.18) });
        y -= 18;
      }
      y -= 16;
    }

    if (i === 0) {
      const calloutY = 390;
      page.drawRectangle({ x: 56, y: calloutY - 90, width: 483, height: 130, color: PALE });
      page.drawText("TRY THIS", { x: 76, y: calloutY + 14, size: 8, font: mono, color: ACCENT });
      page.drawText("Choose the highlighter, pick a colour in the floating palette, and draw across a line.", {
        x: 76,
        y: calloutY - 14,
        size: 11,
        font: regular,
        color: INK,
        maxWidth: 430,
      });
      page.drawText("Then open the notes panel and link a note to this page.", {
        x: 76,
        y: calloutY - 34,
        size: 11,
        font: regular,
        color: MUTED,
        maxWidth: 430,
      });
    } else if (i === 1) {
      const panelY = 445;
      page.drawRectangle({ x: 56, y: panelY, width: 232, height: 150, color: rgb(0.94, 0.95, 0.96) });
      page.drawRectangle({ x: 307, y: panelY, width: 232, height: 150, color: rgb(0.94, 0.95, 0.96) });
      page.drawText("Pane A", { x: 76, y: panelY + 120, size: 9, font: mono, color: MUTED });
      page.drawText("Pane B", { x: 327, y: panelY + 120, size: 9, font: mono, color: MUTED });
      for (let line = 0; line < 4; line += 1) {
        page.drawLine({
          start: { x: 76, y: panelY + 98 - line * 15 },
          end: { x: 268, y: panelY + 98 - line * 15 },
          thickness: 2,
          color: line === 3 ? ACCENT : LINE,
        });
        page.drawLine({
          start: { x: 327, y: panelY + 98 - line * 15 },
          end: { x: 519, y: panelY + 98 - line * 15 },
          thickness: 2,
          color: LINE,
        });
      }
    } else if (i === 2) {
      const swatches = ["#f4d06f", "#86c99a", "#7fb2ee", "#e84b3c", "#111111"];
      swatches.forEach((hex, index) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        page.drawCircle({ x: 75 + index * 44, y: 470, size: 13, color: rgb(r, g, b) });
      });
      page.drawText("Highlight · Underline · Pen · Shapes · Margin notes", {
        x: 56,
        y: 420,
        size: 10,
        font: regular,
        color: MUTED,
      });
    }

    page.drawText(`${String(i + 2).padStart(2, "0")} / 06`, { x: 500, y: 60, size: 8, font: mono, color: MUTED });
    page.drawText("PDFreader · interactive sample", { x: 56, y: 60, size: 8, font: regular, color: MUTED });
  }

  return pdf.save();
}

function wrapText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
