import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { applyPageEdits } from "../features/workspace/pageOps";

async function makePdf(pageCount = 3): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([400, 600]);
    page.drawText(`Page ${index + 1}`, { x: 30, y: 300, size: 20, font });
  }
  return pdf.save();
}

describe("page organization", () => {
  it("reorders and rotates pages in a new document", async () => {
    const bytes = await makePdf(3);
    const output = await applyPageEdits(
      bytes,
      [
        { sourceIndex: 2, rotation: 0 },
        { sourceIndex: 0, rotation: 90 },
        { sourceIndex: 1, rotation: 180 },
      ],
      "Edited",
    );
    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(3);
    expect(result.getTitle()).toBe("Edited");
    expect(result.getPage(1).getRotation().angle).toBe(90);
    expect(result.getPage(2).getRotation().angle).toBe(180);
  });

  it("saves all pages when no edits are supplied", async () => {
    const bytes = await makePdf(2);
    const output = await applyPageEdits(bytes, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
    ]);
    expect((await PDFDocument.load(output)).getPageCount()).toBe(2);
  });

  it("rejects an empty result and out-of-range page indexes", async () => {
    const bytes = await makePdf(3);
    await expect(applyPageEdits(bytes, [])).rejects.toThrow(/at least one page/);
    await expect(applyPageEdits(bytes, [{ sourceIndex: 7, rotation: 0 }])).rejects.toThrow(/outside/);
  });
});
