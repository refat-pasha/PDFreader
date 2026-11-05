import type { Annotation, DocumentMeta, ExportOptions } from "../../types";

type TextPage = { pageIndex: number; text: string };

export function exportMarkdown(
  doc: DocumentMeta,
  textPages: TextPage[],
  annotations: Annotation[],
  options: ExportOptions,
): string {
  const lines: string[] = [];
  lines.push(`# ${doc.name.replace(/\.pdf$/i, "")}`);
  lines.push("");
  lines.push(`*Exported from PDFreader on ${new Date().toLocaleDateString()}*`);
  lines.push("");
  if (options.pageRange.trim()) {
    lines.push(`> Page range requested: ${options.pageRange}`);
    lines.push("");
  }
  for (const page of textPages) {
    lines.push(`## Page ${page.pageIndex + 1}`);
    lines.push("");
    const blocks = page.text
      .split(/\n\s*\n|\n/)
      .map((block) => block.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (blocks.length === 0) {
      lines.push("*No extractable text on this page.*");
      lines.push("");
      continue;
    }
    for (const block of blocks) lines.push(block, "");
  }

  const pageAnnotations = annotations.filter((annotation) => annotation.docId === doc.id);
  if (options.includeAnnotationSummary && pageAnnotations.length) {
    lines.push("## Reading notes", "");
    for (const annotation of pageAnnotations.sort((a, b) => a.pageIndex - b.pageIndex)) {
      const note = annotation.text ? ` — ${annotation.text}` : "";
      lines.push(`- **Page ${annotation.pageIndex + 1}** · ${annotation.kind}${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function exportText(textPages: TextPage[]): string {
  return textPages
    .map((page) => `--- Page ${page.pageIndex + 1} ---\n${page.text}`)
    .join("\n\n");
}
