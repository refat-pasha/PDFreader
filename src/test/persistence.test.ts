import { describe, expect, it } from "vitest";
import { buildSession, docKeyFor } from "../app/persistence";
import type { DocumentMeta, Pane } from "../types";

const docs: Record<string, DocumentMeta> = {
  local: {
    id: "local",
    name: "paper.pdf",
    path: "C:\\Docs\\paper.pdf",
    pageCount: 12,
    size: 4321,
    source: "local",
    openedAt: 1,
  },
  demo: {
    id: "demo",
    name: "A quieter way to read.pdf",
    pageCount: 7,
    size: 7000,
    source: "demo",
    openedAt: 2,
  },
  browser: {
    id: "browser",
    name: "temporary.pdf",
    pageCount: 1,
    size: 10,
    source: "browser",
    openedAt: 3,
  },
};

const view = { page: 3, scale: 1.25, zoomMode: "custom" as const, rotation: 90, scrollTop: 0 };

const panes: Pane[] = [
  { id: "pane-a", tabs: ["local", "browser"], activeDocId: "local", view },
  { id: "pane-b", tabs: ["demo"], activeDocId: "demo", view: { ...view, page: 2 } },
];

describe("workspace session persistence", () => {
  it("stores only reopenable documents and preserves pane views", () => {
    const session = buildSession({ documents: docs, panes, activePaneId: "pane-b" });
    expect(session.documents.map((doc) => doc.name)).toEqual([
      "paper.pdf",
      "A quieter way to read.pdf",
    ]);
    expect(session.panes[0].tabs).toHaveLength(1);
    expect(session.panes[0].activeDocKey).toBe(docKeyFor(docs.local));
    expect(session.panes[1].activeDocKey).toBe(docKeyFor(docs.demo));
    expect(session.panes[1].view).toMatchObject({ page: 2, scale: 1.25, rotation: 90 });
    expect(session.activePaneIndex).toBe(1);
  });

  it("keeps an empty pane from breaking the session", () => {
    const session = buildSession({
      documents: docs,
      panes: [{ id: "pane-empty", tabs: [], view: { page: 1, scale: 1, zoomMode: "fit-page", rotation: 0, scrollTop: 0 } }],
      activePaneId: "pane-empty",
    });
    expect(session.documents).toEqual([]);
    expect(session.panes[0].tabs).toEqual([]);
    expect(session.activePaneIndex).toBe(0);
  });
});
