import { create } from "zustand";
import type {
  Annotation,
  Bookmark,
  DocumentMeta,
  ExportOptions,
  OutlineNode,
  Pane,
  SidebarPanel,
  Toast,
  Tool,
  ZoomMode,
} from "../../types";
import { clampScale, clampPage } from "./geometry";

export type NoteLink = {
  id: string;
  docId: string;
  docName: string;
  pageIndex: number;
  annotationId?: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  links: NoteLink[];
};

type HistoryEntry = {
  before: Annotation[];
  after: Annotation[];
};

type WorkspaceState = {
  documents: Record<string, DocumentMeta>;
  panes: Pane[];
  activePaneId: string;
  activeTool: Tool;
  toolColors: Record<string, string>;
  toolWidths: Record<string, number>;
  toolOpacity: number;
  annotations: Annotation[];
  bookmarks: Bookmark[];
  history: Record<string, HistoryEntry[]>;
  redo: Record<string, HistoryEntry[]>;
  notes: Note[];
  activeNoteId?: string;
  sidebar: SidebarPanel;
  sidebarOpen: boolean;
  rightPanel: "none" | "notes" | "markup";
  focusMode: boolean;
  theme: "dark" | "light";
  syncScroll: boolean;
  paletteOpen: boolean;
  commandOpen: boolean;
  exportOpen: boolean;
  settingsOpen: boolean;
  exportOptions: ExportOptions;
  toasts: Toast[];

  addDocument: (doc: DocumentMeta) => string;
  openDocumentInPane: (docId: string, paneId?: string) => void;
  closeTab: (paneId: string, docId: string) => void;
  closeOtherTabs: (paneId: string, docId: string) => void;
  closeAllTabs: (paneId: string) => void;
  setActiveTab: (paneId: string, docId: string) => void;
  splitPane: (paneId: string, direction?: "row" | "column") => void;
  closePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  setView: (paneId: string, patch: Partial<Pane["view"]>) => void;
  setPage: (paneId: string, page: number, pageCount: number) => void;
  setZoom: (paneId: string, scale: number, mode?: ZoomMode) => void;
  setActiveTool: (tool: Tool) => void;
  setToolColor: (tool: Tool, color: string) => void;
  setToolWidth: (tool: Tool, width: number) => void;
  setToolOpacity: (opacity: number) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;
  addBookmark: (docId: string, pageIndex: number, label?: string) => void;
  removeBookmark: (id: string) => void;
  undo: (docId: string) => void;
  redoAction: (docId: string) => void;
  addNote: (note?: Partial<Note>) => string;
  updateNote: (id: string, patch: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  setActiveNote: (id?: string) => void;
  setSidebar: (panel: SidebarPanel) => void;
  toggleSidebar: () => void;
  setRightPanel: (panel: "none" | "notes" | "markup") => void;
  toggleFocusMode: () => void;
  toggleTheme: () => void;
  toggleSyncScroll: () => void;
  setPaletteOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setExportOptions: (patch: Partial<ExportOptions>) => void;
  toast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: string) => void;
};

export const defaultExportOptions: ExportOptions = {
  format: "pdf",
  pageRange: "",
  flattenAnnotations: true,
  includeAnnotationSummary: true,
  imageDpi: 150,
  ocr: false,
  ocrLanguage: "eng",
  wordLayout: "editable",
};

const initialPane: Pane = {
  id: "pane-1",
  tabs: [],
  view: { page: 1, scale: 1, zoomMode: "fit-page", rotation: 0, scrollTop: 0 },
};

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  documents: {},
  panes: [initialPane],
  activePaneId: initialPane.id,
  activeTool: "select",
  toolColors: {
    pen: "#111111",
    highlighter: "#ffe45c",
    rect: "#e84b3c",
    ellipse: "#e84b3c",
    arrow: "#e84b3c",
    text: "#111111",
    note: "#f5b400",
  },
  toolWidths: { pen: 2, highlighter: 12, rect: 2, ellipse: 2, arrow: 2, text: 12 },
  toolOpacity: 1,
  annotations: [],
  bookmarks: [],
  history: {},
  redo: {},
  notes: [
    {
      id: "welcome-note",
      title: "Reading log",
      body:
        "# Reading log\n\nThis notebook lives beside the document. Link a note to the page you are reading and it will remain a clickable reference.\n\n- Use **Ctrl+M** to open the notebook.\n- Select a passage, then choose **Link selection** in the note toolbar.\n- Export notes as Markdown from the notes panel.",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      links: [],
    },
  ],
  activeNoteId: undefined,
  sidebar: "thumbnails",
  sidebarOpen: true,
  rightPanel: "none",
  focusMode: false,
  theme: "dark",
  syncScroll: false,
  paletteOpen: false,
  commandOpen: false,
  exportOpen: false,
  settingsOpen: false,
  exportOptions: defaultExportOptions,
  toasts: [],

  addDocument: (doc) => {
    set((state) => ({ documents: { ...state.documents, [doc.id]: doc } }));
    return doc.id;
  },

  openDocumentInPane: (docId, paneId) => {
    const targetId = paneId ?? get().activePaneId;
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== targetId) return pane;
        const tabs = pane.tabs.includes(docId) ? pane.tabs : [...pane.tabs, docId];
        return { ...pane, tabs, activeDocId: docId, view: { ...pane.view, page: 1 } };
      }),
      activePaneId: targetId,
    }));
  },

  closeTab: (paneId, docId) => {
    const state = get();
    const pane = state.panes.find((p) => p.id === paneId);
    if (!pane) return;
    const tabs = pane.tabs.filter((id) => id !== docId);
    let panes = state.panes.map((p) => {
      if (p.id !== paneId) return p;
      const activeDocId = p.activeDocId === docId ? tabs[tabs.length - 1] : p.activeDocId;
      return { ...p, tabs, activeDocId };
    });
    if (tabs.length === 0 && panes.length > 1) {
      panes = panes.filter((p) => p.id !== paneId);
      if (!panes.some((p) => p.id === state.activePaneId)) {
        panes[panes.length - 1].activeDocId = panes[panes.length - 1].tabs[0];
      }
    }
    const stillOpen = panes.some((p) => p.tabs.includes(docId));
    set({
      panes,
      activePaneId: panes.some((p) => p.id === state.activePaneId)
        ? state.activePaneId
        : panes[0].id,
      // Document metadata and draft markup are retained for re-opening, while
      // native page resources are released by the application layer.
    });
  },

  closeOtherTabs: (paneId, docId) => {
    const state = get();
    const pane = state.panes.find((p) => p.id === paneId);
    if (!pane) return;
    if (!pane.tabs.includes(docId)) return;
    set((current) => ({
      panes: current.panes.map((item) =>
        item.id === paneId ? { ...item, tabs: [docId], activeDocId: docId } : item,
      ),
    }));
  },

  closeAllTabs: (paneId) => {
    const state = get();
    const pane = state.panes.find((p) => p.id === paneId);
    if (!pane) return;
    let panes = state.panes.map((item) =>
      item.id === paneId ? { ...item, tabs: [], activeDocId: undefined } : item,
    );
    if (panes.length > 1) {
      panes = panes.filter((item) => item.id !== paneId);
    }
    set({
      panes,
      activePaneId: panes.some((item) => item.id === state.activePaneId) ? state.activePaneId : panes[0].id,
    });
  },

  setActiveTab: (paneId, docId) => {
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              activeDocId: docId,
              view: { ...pane.view, page: 1 },
            }
          : pane,
      ),
      activePaneId: paneId,
    }));
  },

  splitPane: (paneId) => {
    const state = get();
    if (state.panes.length >= 4) {
      get().toast("Up to four panes can be open at once.", "info");
      return;
    }
    const source = state.panes.find((p) => p.id === paneId);
    if (!source) return;
    const newId = `pane-${Date.now()}`;
    const pane: Pane = {
      id: newId,
      tabs: [...source.tabs],
      activeDocId: source.activeDocId,
      view: { ...source.view },
    };
    set((s) => ({ panes: [...s.panes, pane], activePaneId: newId }));
  },

  closePane: (paneId) => {
    const state = get();
    if (state.panes.length === 1) return;
    const panes = state.panes.filter((p) => p.id !== paneId);
    set({
      panes,
      activePaneId: panes.some((p) => p.id === state.activePaneId) ? state.activePaneId : panes[0].id,
    });
  },

  setActivePane: (paneId) => set({ activePaneId: paneId }),

  setView: (paneId, patch) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId ? { ...pane, view: { ...pane.view, ...patch } } : pane,
      ),
    })),

  setPage: (paneId, page, pageCount) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? { ...pane, view: { ...pane.view, page: clampPage(page, pageCount) } }
          : pane,
      ),
    })),

  setZoom: (paneId, scale, mode = "custom") =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId
          ? { ...pane, view: { ...pane.view, scale: clampScale(scale), zoomMode: mode } }
          : pane,
      ),
    })),

  setActiveTool: (tool) => set({ activeTool: tool, paletteOpen: tool !== "select" && tool !== "hand" }),
  setToolColor: (tool, color) =>
    set((state) => ({ toolColors: { ...state.toolColors, [tool]: color } })),
  setToolWidth: (tool, width) =>
    set((state) => ({ toolWidths: { ...state.toolWidths, [tool]: width } })),
  setToolOpacity: (opacity) => set({ toolOpacity: opacity }),

  addAnnotation: (annotation) =>
    set((state) => ({
      annotations: [...state.annotations, annotation],
      history: {
        ...state.history,
        [annotation.docId]: [
          ...(state.history[annotation.docId] ?? []).slice(-49),
          { before: [], after: [annotation] },
        ],
      },
      redo: { ...state.redo, [annotation.docId]: [] },
    })),

  updateAnnotation: (id, patch) =>
    set((state) => ({
      annotations: state.annotations.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)),
    })),

  deleteAnnotation: (id) =>
    set((state) => {
      const target = state.annotations.find((a) => a.id === id);
      if (!target) return {};
      return {
        annotations: state.annotations.filter((a) => a.id !== id),
        history: {
          ...state.history,
          [target.docId]: [
            ...(state.history[target.docId] ?? []).slice(-49),
            { before: [target], after: [] },
          ],
        },
        redo: { ...state.redo, [target.docId]: [] },
      };
    }),

  addBookmark: (docId, pageIndex, label) =>
    set((state) => {
      if (state.bookmarks.some((bookmark) => bookmark.docId === docId && bookmark.pageIndex === pageIndex)) {
        return {};
      }
      const bookmark: Bookmark = {
        id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        docId,
        pageIndex,
        label: label?.trim() || `Page ${pageIndex + 1}`,
        createdAt: Date.now(),
      };
      return { bookmarks: [...state.bookmarks, bookmark] };
    }),

  removeBookmark: (id) =>
    set((state) => ({ bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== id) })),

  undo: (docId) => {
    const state = get();
    const entries = state.history[docId] ?? [];
    const entry = entries[entries.length - 1];
    if (!entry) {
      get().toast("Nothing to undo for this document.", "info");
      return;
    }
    const removedIds = new Set(entry.after.map((a) => a.id));
    set({
      annotations: [...state.annotations.filter((a) => !removedIds.has(a.id)), ...entry.before],
      history: { ...state.history, [docId]: entries.slice(0, -1) },
      redo: { ...state.redo, [docId]: [...(state.redo[docId] ?? []), entry] },
    });
  },

  redoAction: (docId) => {
    const state = get();
    const entries = state.redo[docId] ?? [];
    const entry = entries[entries.length - 1];
    if (!entry) {
      get().toast("Nothing to redo for this document.", "info");
      return;
    }
    const removedIds = new Set(entry.before.map((a) => a.id));
    set({
      annotations: [...state.annotations.filter((a) => !removedIds.has(a.id)), ...entry.after],
      redo: { ...state.redo, [docId]: entries.slice(0, -1) },
      history: { ...state.history, [docId]: [...(state.history[docId] ?? []), entry] },
    });
  },

  addNote: (partial = {}) => {
    const now = Date.now();
    const note: Note = {
      id: partial.id ?? `note-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: partial.title ?? "Untitled note",
      body: partial.body ?? "",
      createdAt: partial.createdAt ?? now,
      updatedAt: partial.updatedAt ?? now,
      links: partial.links ?? [],
    };
    set((state) => ({ notes: [note, ...state.notes], activeNoteId: note.id }));
    return note.id;
  },

  updateNote: (id, patch) =>
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note,
      ),
    })),

  deleteNote: (id) =>
    set((state) => {
      const notes = state.notes.filter((note) => note.id !== id);
      return { notes, activeNoteId: state.activeNoteId === id ? notes[0]?.id : state.activeNoteId };
    }),

  setActiveNote: (id) => set({ activeNoteId: id }),
  setSidebar: (panel) => set({ sidebar: panel, sidebarOpen: true }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setRightPanel: (panel) => set({ rightPanel: panel }),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  toggleTheme: () =>
    set((state) => {
      const theme = state.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      return { theme };
    }),
  toggleSyncScroll: () => set((state) => ({ syncScroll: !state.syncScroll })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  setExportOpen: (open) => set({ exportOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setExportOptions: (patch) =>
    set((state) => ({ exportOptions: { ...state.exportOptions, ...patch } })),
  toast: (message, kind = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }));
    window.setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export function activePane(state: WorkspaceState): Pane {
  return state.panes.find((pane) => pane.id === state.activePaneId) ?? state.panes[0];
}

export function activeDocumentMeta(state: WorkspaceState): DocumentMeta | undefined {
  const pane = activePane(state);
  return pane.activeDocId ? state.documents[pane.activeDocId] : undefined;
}

export type { Note as NoteRecord, WorkspaceState };
