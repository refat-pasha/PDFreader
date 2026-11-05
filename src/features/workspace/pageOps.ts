import { degrees, PDFDocument } from "pdf-lib";

export type PageEdit = {
  /** Zero-based page index in the original PDF. */
  sourceIndex: number;
  /** Additional clockwise rotation in degrees. */
  rotation: number;
};

/**
 * Build a new PDF from an edited page list. The caller supplies a validated,
 * non-empty list; source page objects are copied, never mutated in place.
 */
export async function applyPageEdits(
  bytes: Uint8Array,
  pages: PageEdit[],
  title?: string,
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("A PDF must contain at least one page.");
  const source = await PDFDocument.load(bytes);
  if (pages.some((page) => page.sourceIndex < 0 || page.sourceIndex >= source.getPageCount())) {
    throw new Error("The page selection is outside the document.");
  }
  const output = await PDFDocument.create();
  if (title) output.setTitle(title);
  output.setProducer("PDFreader");
  output.setCreator("PDFreader");
  const copied = await output.copyPages(source, pages.map((page) => page.sourceIndex));
  copied.forEach((page, index) => {
    const extra = ((pages[index].rotation % 360) + 360) % 360;
    if (extra !== 0) {
      const base = page.getRotation().angle ?? 0;
      page.setRotation(degrees((base + extra) % 360));
    }
    output.addPage(page);
  });
  return new Uint8Array(await output.save({ useObjectStreams: true }));
}
