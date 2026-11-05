import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "../features/workspace/store";
import { createAnnotation } from "../features/annotate/model";

const baseDoc = {
  id: "doc-a",
  name: "paper.pdf",
  pageCount: 12,
  size: 1000,
  source: "browser" as const,
  openedAt: Date.now(),
};

function reset() {
  useWorkspace.setState({
    documents: {},
    panes: [
      {
        id: "pane-1",
        tabs: [],
        view: { page: 1, scale: 1, zoomMode: "fit-width", rotation: 0, scrollTop: 0 },
      },
    ],
    activePaneId: "pane-1",
    annotations: [],
    history: {},
    redo: {},
    notes: [],
    bookmarks: [],
    activeNoteId: undefined,
    rightPanel: "none",
  });
}

describe("workspace store", () => {
  beforeEach(reset);

  it("opens, switches, and closes documents in a pane", () => {
    const state = useWorkspace.getState();
    state.addDocument(baseDoc);
    state.openDocumentInPane(baseDoc.id);
    expect(useWorkspace.getState().panes[0].tabs).toEqual(["doc-a"]);
    expect(useWorkspace.getState().panes[0].activeDocId).toBe("doc-a");
    useWorkspace.getState().closeTab("pane-1", "doc-a");
    expect(useWorkspace.getState().panes[0].tabs).toEqual([]);
  });

  it("splits a pane, copies the active document, and collapses it again", () => {
    useWorkspace.getState().addDocument(baseDoc);
    useWorkspace.getState().openDocumentInPane(baseDoc.id);
    useWorkspace.getState().splitPane("pane-1");
    expect(useWorkspace.getState().panes).toHaveLength(2);
    expect(useWorkspace.getState().panes[1].activeDocId).toBe("doc-a");
    useWorkspace.getState().closePane(useWorkspace.getState().panes[1].id);
    expect(useWorkspace.getState().panes).toHaveLength(1);
  });

  it("supports undo and redo for annotation creation", () => {
    useWorkspace.getState().addDocument(baseDoc);
    const annotation = createAnnotation({
      docId: "doc-a",
      pageIndex: 0,
      kind: "pen",
      color: "#111111",
      opacity: 1,
      strokeWidth: 2,
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    });
    useWorkspace.getState().addAnnotation(annotation);
    expect(useWorkspace.getState().annotations).toHaveLength(1);
    useWorkspace.getState().undo("doc-a");
    expect(useWorkspace.getState().annotations).toHaveLength(0);
    useWorkspace.getState().redoAction("doc-a");
    expect(useWorkspace.getState().annotations).toHaveLength(1);
  });

  it("clamps page and zoom changes to supported bounds", () => {
    useWorkspace.getState().addDocument(baseDoc);
    useWorkspace.getState().openDocumentInPane(baseDoc.id);
    useWorkspace.getState().setPage("pane-1", 99, baseDoc.pageCount);
    expect(useWorkspace.getState().panes[0].view.page).toBe(12);
    useWorkspace.getState().setZoom("pane-1", 99);
    expect(useWorkspace.getState().panes[0].view.scale).toBe(8);
  });

  it("closes other and all tabs in a pane", () => {
    useWorkspace.getState().openDocumentInPane("doc-b");
    useWorkspace.getState().openDocumentInPane("doc-a");
    expect(useWorkspace.getState().panes[0].tabs).toHaveLength(2);
    useWorkspace.getState().closeOtherTabs(useWorkspace.getState().panes[0].id, "doc-b");
    expect(useWorkspace.getState().panes[0].tabs).toEqual(["doc-b"]);
    expect(useWorkspace.getState().panes[0].activeDocId).toBe("doc-b");
    useWorkspace.getState().closeAllTabs(useWorkspace.getState().panes[0].id);
    expect(useWorkspace.getState().panes[0].tabs).toEqual([]);
    expect(useWorkspace.getState().panes[0].activeDocId).toBeUndefined();
  });

  it("creates, edits, and deletes notes", () => {
    const id = useWorkspace.getState().addNote({ title: "Method", body: "# Notes" });
    useWorkspace.getState().updateNote(id, { body: "updated" });
    expect(useWorkspace.getState().notes.find((note) => note.id === id)?.body).toBe("updated");
    useWorkspace.getState().deleteNote(id);
    expect(useWorkspace.getState().notes.find((note) => note.id === id)).toBeUndefined();
  });

  it("adds, de-duplicates, and removes page bookmarks", () => {
    useWorkspace.getState().addBookmark("doc-a", 2, "Method");
    useWorkspace.getState().addBookmark("doc-a", 2, "Duplicate should be ignored");
    useWorkspace.getState().addBookmark("doc-a", 4);
    const bookmarks = useWorkspace.getState().bookmarks;
    expect(bookmarks).toHaveLength(2);
    expect(bookmarks[0].label).toBe("Method");
    expect(bookmarks[1].label).toBe("Page 5");
    useWorkspace.getState().removeBookmark(bookmarks[0].id);
    expect(useWorkspace.getState().bookmarks).toHaveLength(1);
  });
});
