import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";

await mkdir("tests/fixtures", { recursive: true });
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let index = 0; index < 2; index += 1) {
  const page = pdf.addPage([400, 600]);
  page.drawText(`Native PDFium fixture page ${index + 1}`, { x: 36, y: 540, size: 18, font });
}
await writeFile("tests/fixtures/native-sample.pdf", await pdf.save());
console.log("tests/fixtures/native-sample.pdf");
