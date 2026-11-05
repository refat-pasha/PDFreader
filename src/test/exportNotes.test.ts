import { describe, expect, it } from "vitest";
import { notesFilename, notesToMarkdown } from "../features/notes/exportNotes";
import type { Note } from "../features/workspace/store";

const notes: Note[] = [
  {
    id: "n1",
    title: "Method",
    body: "# Key idea\n\nUse stratified sampling.",
    createdAt: Date.UTC(2026, 10, 5),
    updatedAt: Date.UTC(2026, 10, 5),
    links: [
      { id: "l1", docId: "d1", docName: "paper.pdf", pageIndex: 4 },
      { id: "l2", docId: "d2", docName: "notes.pdf", pageIndex: 0 },
    ],
  },
  {
    id: "n2",
    title: "",
    body: "",
    createdAt: Date.UTC(2026, 10, 5),
    updatedAt: Date.UTC(2026, 10, 5),
    links: [],
  },
];
const date = new Date(Date.UTC(2026, 10, 5, 12, 0));

describe("notebook Markdown export", () => {
  it("includes note bodies and linked pages", () => {
    const markdown = notesToMarkdown(notes, date);
    expect(markdown).toContain("# PDFreader notebook");
    expect(markdown).toContain("## Method");
    expect(markdown).toContain("Use stratified sampling.");
    expect(markdown).toContain("- paper.pdf, page 5");
    expect(markdown).toContain("- notes.pdf, page 1");
    expect(markdown).toContain("## Untitled note");
  });

  it("produces a dated safe filename", () => {
    expect(notesFilename(date)).toBe("pdfreader-notes-2026-11-05.md");
  });

  it("handles an empty notebook", () => {
    expect(notesToMarkdown([], date)).toContain("_No notes._");
  });
});
