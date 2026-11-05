import type { Note } from "../workspace/store";

export function notesToMarkdown(notes: Note[], exportedAt = new Date()): string {
  const lines: string[] = ["# PDFreader notebook", "", `*Exported ${exportedAt.toLocaleString()}*`, ""];
  if (notes.length === 0) {
    lines.push("_No notes._", "");
    return lines.join("\n");
  }
  for (const note of notes) {
    lines.push(`## ${note.title.trim() || "Untitled note"}`, "");
    if (note.body.trim()) {
      lines.push(note.body.trim(), "");
    }
    if (note.links.length > 0) {
      lines.push("**Linked pages**", "");
      for (const link of note.links) {
        lines.push(`- ${link.docName}, page ${link.pageIndex + 1}`);
      }
      lines.push("");
    }
    lines.push(`*Updated ${new Date(note.updatedAt).toLocaleString()}*`, "");
  }
  return lines.join("\n");
}

export function notesFilename(date = new Date()): string {
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `pdfreader-notes-${stamp}.md`;
}
