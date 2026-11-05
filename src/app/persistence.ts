import type { Annotation, Bookmark, DocumentMeta, Pane, PaneView } from "../types";
import { useWorkspace } from "../features/workspace/store";

const STORAGE_KEY = "pdfreader.workspace.v1";

type StoredAnnotation = Omit<Annotation, "docId"> & { docKey: string };
type StoredBookmark = Omit<Bookmark, "docId"> & { docKey: string };

export type StoredDocument = {
  docKey: string;
  path?: string;
  name: string;
  pageCount: number;
  size: number;
  source: DocumentMeta["source"];
};

export type StoredPane = {
  tabs: string[];
  activeDocKey?: string;
  view: PaneView;
};

export type StoredSession = {
  documents: StoredDocument[];
  panes: StoredPane[];
  activePaneIndex: number;
};

type StoredState = {
  version: 1 | 2 | 3;
  annotations: StoredAnnotation[];
  bookmarks?: StoredBookmark[];
  notes: ReturnType<typeof useWorkspace.getState>["notes"];
  theme: "dark" | "light";
  toolColors: Record<string, string>;
  toolWidths: Record<string, number>;
  toolOpacity: number;
  exportOptions: ReturnType<typeof useWorkspace.getState>["exportOptions"];
  syncScroll: boolean;
  session?: StoredSession;
};

export function docKeyFor(doc: { path?: string; name: string; pageCount: number }): string {
  return `${doc.path ?? doc.name}::${doc.pageCount}`;
}

/** Build the persistent workspace session from the live store. */
export function buildSession(state: {
  documents: Record<string, DocumentMeta>;
  panes: Pane[];
  activePaneId: string;
}): StoredSession {
  const docKeys = new Map<string, string>();
  const documents: StoredDocument[] = [];
  const seen = new Set<string>();
  for (const pane of state.panes) {
    for (const docId of pane.tabs) {
      const doc = state.documents[docId];
      if (!doc) continue;
      // Browser file handles cannot be reopened after a reload; only local
      // paths and the generated demo are valid for restoration.
      if (doc.source === "browser") continue;
      if (doc.source === "local" && !doc.path) continue;
      const key = docKeyFor(doc);
      docKeys.set(docId, key);
      if (!seen.has(key)) {
        seen.add(key);
        documents.push({
          docKey: key,
          path: doc.path,
          name: doc.name,
          pageCount: doc.pageCount,
          size: doc.size,
          source: doc.source,
        });
      }
    }
  }
  const panes: StoredPane[] = state.panes.map((pane) => ({
    tabs: pane.tabs.map((docId) => docKeys.get(docId)).filter((key): key is string => Boolean(key)),
    activeDocKey: pane.activeDocId ? docKeys.get(pane.activeDocId) : undefined,
    view: { ...pane.view },
  }));
  const activePaneIndex = Math.max(
    0,
    state.panes.findIndex((pane) => pane.id === state.activePaneId),
  );
  return { documents, panes, activePaneIndex };
}

export function readPersistedSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredState;
    if (parsed.version !== 2 && parsed.version !== 3) return null;
    if (!parsed.session) return null;
    const session = parsed.session;
    if (!Array.isArray(session.documents) || !Array.isArray(session.panes)) return null;
    return session;
  } catch {
    return null;
  }
}

export function loadPersistedState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredState;
    if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) return;
    useWorkspace.setState((state) => ({
      notes: parsed.notes?.length ? parsed.notes : state.notes,
      theme: parsed.theme ?? state.theme,
      toolColors: { ...state.toolColors, ...(parsed.toolColors ?? {}) },
      toolWidths: { ...state.toolWidths, ...(parsed.toolWidths ?? {}) },
      toolOpacity: parsed.toolOpacity ?? state.toolOpacity,
      exportOptions: { ...state.exportOptions, ...(parsed.exportOptions ?? {}) },
      syncScroll: parsed.syncScroll ?? state.syncScroll,
    }));
    if (parsed.theme) document.documentElement.dataset.theme = parsed.theme;
  } catch {
    // A corrupt local draft should never prevent the application from starting.
  }
}

let persistTimer: number | undefined;

export function attachPersistence(): () => void {
  const persist = () => {
    const state = useWorkspace.getState();
    const documents = state.documents;
    const stored: StoredAnnotation[] = state.annotations.map((annotation) => {
      const doc = documents[annotation.docId];
      const { docId: _docId, ...rest } = annotation;
      return { ...rest, docKey: doc ? docKeyFor(doc) : `unknown::${annotation.docId}` };
    });
    const storedBookmarks: StoredBookmark[] = state.bookmarks.map((bookmark) => {
      const doc = documents[bookmark.docId];
      const { docId: _docId, ...rest } = bookmark;
      return { ...rest, docKey: doc ? docKeyFor(doc) : `unknown::${bookmark.docId}` };
    });
    const payload: StoredState = {
      version: 3,
      annotations: stored,
      bookmarks: storedBookmarks,
      notes: state.notes,
      theme: state.theme,
      toolColors: state.toolColors,
      toolWidths: state.toolWidths,
      toolOpacity: state.toolOpacity,
      exportOptions: state.exportOptions,
      syncScroll: state.syncScroll,
      session: buildSession(state),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota or private-mode failures are non-fatal; drafts remain in memory.
    }
  };

  const unsubscribe = useWorkspace.subscribe(() => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persist, 350);
  });
  const onBeforeUnload = () => persist();
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.clearTimeout(persistTimer);
    persist();
  };
}

/** Restore drafts for a document after it has been registered in this session. */
export function rehydrateDocument(doc: { id: string; path?: string; name: string; pageCount: number }): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as StoredState;
    const key = docKeyFor(doc);
    const restored = (parsed.annotations ?? []).filter((annotation) => annotation.docKey === key);
    const restoredBookmarks = (parsed.bookmarks ?? []).filter((bookmark) => bookmark.docKey === key);
    const state = useWorkspace.getState();
    const additions = restored
      .filter((annotation) => !state.annotations.some((item) => item.id === annotation.id))
      .map(({ docKey: _docKey, ...annotation }) => ({ ...annotation, docId: doc.id }));
    const bookmarkAdditions = restoredBookmarks
      .filter((bookmark) => !state.bookmarks.some((item) => item.id === bookmark.id))
      .map(({ docKey: _docKey, ...bookmark }) => ({ ...bookmark, docId: doc.id }));
    if (additions.length || bookmarkAdditions.length) {
      useWorkspace.setState((current) => ({
        annotations: [...current.annotations, ...additions],
        bookmarks: [...current.bookmarks, ...bookmarkAdditions],
      }));
    }
  } catch {
    // Ignore malformed drafts.
  }
}
