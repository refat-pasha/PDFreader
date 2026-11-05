import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { Document, Packer, Paragraph, TextRun } from "docx";

mkdirSync("tests/.artifacts", { recursive: true });
const document = new Document({
  creator: "PDFreader verification",
  title: "PDFreader DOCX conversion test",
  sections: [
    {
      children: [
        new Paragraph({ children: [new TextRun({ text: "PDFreader conversion test", bold: true, size: 32 })] }),
        new Paragraph({ children: [new TextRun({ text: "This document verifies the optional LibreOffice .doc bridge." })] }),
      ],
    },
  ],
});
const buffer = await Packer.toBuffer(document);
await writeFile("tests/.artifacts/conversion-test.docx", buffer);
console.log("tests/.artifacts/conversion-test.docx");
