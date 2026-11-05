import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Info,
  PanelRight,
  StickyNote,
  X,
} from "lucide-react";
import type { Annotation, DocumentMeta, ExportOptions, SearchHit, Tool } from "./types";
import type { Command } from "./features/shell/commands";
import { AppMenuBar } from "./features/shell/AppMenuBar";
import { CommandPalette, ShortcutSheet } from "./features/shell/CommandPalette";
import { ExportDialog } from "./features/shell/ExportDialog";
const PageOrganizer = lazy(() =>
  import("./features/workspace/PageOrganizer").then((module) => ({ default: module.PageOrganizer })),
);
import { useKeyboard } from "./features/shell/useKeyboard";
import { useModalFocus } from "./features/shell/useModalFocus";
import { useUi } from "./features/shell/uiStore";
import { AnnotationPanel } from "./features/annotate/AnnotationPanel";
import { createAnnotation } from "./features/annotate/model";
import { NotesPanel } from "./features/notes/NotesPanel";
import { Sidebar } from "./features/workspace/Sidebar";
import { Workspace } from "./features/workspace/Workspace";
import {
  activeDocumentMeta,
  activePane,
  useWorkspace,
  type NoteLink,
} from "./features/workspace/store";
import { getPageSize, loadPdf, renderPageToCanvas, releasePdf, setPasswordProvider } from "./features/viewer/pdfjs";
import {
  getDocumentBytes,
  isDesktop,
  loadDemoPdf,
  openFromSystem,
  openPathFromSystem,
  openPathsFromNative,
  registerDocument,
  writePdfBytes,
} from "./app/fileService";
import { clearRecentFiles, forgetRecentFile, getRecentFiles, rememberRecent } from "./app/recentFiles";
import { runExport } from "./features/export/exportService";
import { readPersistedSession, rehydrateDocument } from "./app/persistence";
import { nativePageCount } from "./app/nativePdf";

const bytesByDoc = new Map<string, Uint8Array>();

export default function App() {
  const state = useWorkspace();
  const doc = activeDocumentMeta(state);
  const pane = activePane(state);
  const [ready, setReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"current" | "all">("current");
  const [searchBusy, setSearchBusy] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [opening, setOpening] = useState(false);
  const [recentFiles, setRecentFiles] = useState(() => getRecentFiles());
  const [tabMenu, setTabMenu] = useState<{ docId: string; x: number; y: number } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const [passwordRequest, setPasswordRequest] = useState<{
    id: number;
    label: string;
    incorrect: boolean;
    resolve: (password: string | null) => void;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previousOpenIds = useRef<Set<string>>(new Set());
  const modal = useUi((s) => s.modal);
  const closeModal = useUi((s) => s.closeModal);
  const commandOpen = useUi((s) => s.commandOpen);
  const setCommandOpen = useUi((s) => s.setCommandOpen);
  const dropActive = useUi((s) => s.dropActive);
  const setDropActive = useUi((s) => s.setDropActive);

  useEffect(() => {
    if (!tabMenu) return;
    const close = (event: MouseEvent) => {
      if (!tabMenuRef.current?.contains(event.target as Node)) setTabMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);

  const getBytes = useCallback(async (docId: string) => {
    const cached = bytesByDoc.get(docId);
    if (cached) return cached;
    const bytes = await getDocumentBytes(docId);
    bytesByDoc.set(docId, bytes);
    return bytes;
  }, []);

  useEffect(() => {
    setPasswordProvider(
      (label, incorrect) =>
        new Promise((resolve) => {
          setPasswordRequest({ id: Date.now(), label, incorrect, resolve });
        }),
    );
    return () => setPasswordProvider(null);
  }, []);

  const ingest = useCallback(
    async (entries: Array<{ path: string; name: string; bytes: Uint8Array }>, targetPaneId?: string) => {
      if (!entries.length) return;
      setOpening(true);
      try {
        const opened: Array<{ path: string; name: string }> = [];
        for (const entry of entries) {
          let pages: number | null = null;
          if (isDesktop() && !entry.path.startsWith("pdfreader://")) {
            // Let the bundled native PDFium engine validate and count pages.
            // PDF.js is used for interactive rendering and text extraction.
            try {
              pages = await nativePageCount(entry.path);
            } catch {
              // Encrypted/corrupt files fall through to PDF.js, which can prompt for a password.
              pages = null;
            }
          }
          if (!pages) {
            const loaded = await loadPdf(
              `probe-${entry.path}-${entry.bytes.byteLength}`,
              async () => entry.bytes,
              { label: entry.name },
            );
            pages = loaded.pdf.numPages;
            await loaded.cleanup();
          }
          const meta = registerDocument(entry.path, entry.name, entry.bytes, pages);
          bytesByDoc.set(meta.id, entry.bytes);
          useWorkspace.getState().addDocument(meta);
          rehydrateDocument(meta);
          useWorkspace.getState().openDocumentInPane(meta.id, targetPaneId);
          opened.push({ path: entry.path, name: entry.name });
        }
        if (opened.length > 0) setRecentFiles(rememberRecent(opened));
      } catch (error) {
        useWorkspace.getState().toast(
          error instanceof Error ? `Could not open the PDF: ${error.message}` : "Could not open the PDF.",
          "error",
        );
      } finally {
        setOpening(false);
      }
    },
    [],
  );

  const openFiles = useCallback(async () => {
    const entries = await openFromSystem();
    await ingest(entries);
  }, [ingest]);

  const openRecent = useCallback(
    async (path: string) => {
      try {
        const entry = await openPathFromSystem(path);
        await ingest([entry]);
      } catch (error) {
        setRecentFiles(forgetRecentFile(path));
        useWorkspace.getState().toast(
          error instanceof Error ? `Could not open the recent PDF: ${error.message}` : "Could not open the recent PDF.",
          "error",
        );
      }
    },
    [ingest],
  );

  const openDemo = useCallback(async () => {
    const entry = await loadDemoPdf();
    await ingest([entry]);
  }, [ingest]);

  const restoreSession = useCallback(async (): Promise<boolean> => {
    const session = readPersistedSession();
    if (!session || session.documents.length === 0) return false;
    const restoredDocs: Record<string, DocumentMeta> = {};
    const idByKey = new Map<string, string>();
    const skipped: string[] = [];
    for (const stored of session.documents.slice(0, 12)) {
      try {
        let entry: { path: string; name: string; bytes: Uint8Array };
        if (stored.source === "demo") {
          entry = await loadDemoPdf();
        } else if (isDesktop() && stored.path) {
          entry = {
            path: stored.path,
            name: stored.name,
            bytes: await getDocumentBytesFor(stored.path),
          };
        } else {
          skipped.push(stored.name);
          continue;
        }
        const meta = registerDocument(entry.path, entry.name, entry.bytes, stored.pageCount);
        bytesByDoc.set(meta.id, entry.bytes);
        rehydrateDocument(meta);
        restoredDocs[meta.id] = meta;
        idByKey.set(stored.docKey, meta.id);
      } catch {
        skipped.push(stored.name);
      }
    }
    if (idByKey.size === 0) return false;
    const nextPanes = session.panes
      .slice(0, 4)
      .map((storedPane, index) => {
        const tabs = storedPane.tabs
          .map((key) => idByKey.get(key))
          .filter((id): id is string => Boolean(id));
        let activeDocId = storedPane.activeDocKey
          ? idByKey.get(storedPane.activeDocKey)
          : tabs[tabs.length - 1];
        if (activeDocId && !tabs.includes(activeDocId)) activeDocId = tabs[tabs.length - 1];
        const activeDoc = activeDocId ? restoredDocs[activeDocId] : undefined;
        return {
          id: `restored-pane-${index + 1}`,
          tabs,
          activeDocId,
          view: {
            ...storedPane.view,
            page: Math.min(storedPane.view.page, activeDoc?.pageCount ?? storedPane.view.page),
          },
        };
      })
      .filter((pane) => pane.tabs.length > 0);
    if (nextPanes.length === 0) return false;
    useWorkspace.setState((workspace) => ({
      documents: { ...workspace.documents, ...restoredDocs },
      panes: nextPanes,
      activePaneId:
        nextPanes[Math.min(Math.max(0, session.activePaneIndex), nextPanes.length - 1)].id,
    }));
    useWorkspace.getState().toast(
      `Restored ${restoredDocs ? Object.keys(restoredDocs).length : 0} document${
        Object.keys(restoredDocs).length === 1 ? "" : "s"
      } from your last session.`,
      "success",
    );
    if (skipped.length > 0) {
      useWorkspace.getState().toast(
        `Could not reopen: ${skipped.join(", ")}.`,
        "info",
      );
    }
    return true;
  }, []);

  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      try {
        const restored = await restoreSession();
        if (!restored) await openDemo();
      } catch {
        await openDemo();
      } finally {
        setReady(true);
      }
    })();
  }, [openDemo, restoreSession]);

  const openTabIds = state.panes.flatMap((workspacePane) => workspacePane.tabs);
  useEffect(() => {
    const current = new Set(openTabIds);
    for (const id of previousOpenIds.current) {
      if (!current.has(id)) {
        bytesByDoc.delete(id);
        releasePdf(id);
      }
    }
    previousOpenIds.current = current;
  }, [openTabIds]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    openPathsFromNative((paths) => {
      void (async () => {
        const entries = [];
        for (const path of paths) {
          try {
            const bytes = await getDocumentBytesFor(path);
            entries.push({ path, name: path.split(/[\\/]/).pop() ?? path, bytes });
          } catch {
            // Ignore a path that cannot be read; the native side will report it separately.
          }
        }
        await ingest(entries);
      })();
    }).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [ingest]);

  const saveCurrent = useCallback(async () => {
    const current = activeDocumentMeta(useWorkspace.getState());
    if (!current) return;
    try {
      const bytes = await getBytes(current.id);
      const options: ExportOptions = { ...useWorkspace.getState().exportOptions, format: "pdf" };
      const result = await runExport({
        doc: current,
        bytes,
        annotations: useWorkspace.getState().annotations,
        options,
      });
      const data = new Uint8Array(await result.blob.arrayBuffer());
      const destination = await writePdfBytes(data, current.name.replace(/\.pdf$/i, "-annotated.pdf"));
      if (destination) useWorkspace.getState().toast(`Saved ${destination}`, "success");
    } catch (error) {
      useWorkspace.getState().toast(error instanceof Error ? error.message : "Could not save the document.", "error");
    }
  }, [getBytes]);

  const saveAs = useCallback(async () => saveCurrent(), [saveCurrent]);

  const printDocument = useCallback(async () => {
    const current = activeDocumentMeta(useWorkspace.getState());
    if (!current) return;
    try {
      const bytes = await getBytes(current.id);
      const loaded = await loadPdf(`print-${current.id}-${Date.now()}`, async () => bytes);
      const printWindow = window.open("", "_blank", "width=900,height=1200");
      if (!printWindow) {
        useWorkspace.getState().toast("The print window was blocked by the system.", "error");
        await loaded.cleanup();
        return;
      }
      printWindow.document.write(`<!doctype html><title>${current.name}</title><style>body{margin:0;background:#fff}img{display:block;width:100%;page-break-after:always}</style><body>`);
      for (let pageNumber = 1; pageNumber <= loaded.pdf.numPages; pageNumber += 1) {
        const page = await loaded.pdf.getPage(pageNumber);
        const canvas = document.createElement("canvas");
        await renderPageToCanvas(page, canvas, 1.6, 0);
        printWindow.document.write(`<img src="${canvas.toDataURL("image/png")}" alt="Page ${pageNumber}">`);
      }
      printWindow.document.write("</body>");
      printWindow.document.close();
      await loaded.cleanup();
      window.setTimeout(() => printWindow.print(), 250);
    } catch (error) {
      useWorkspace.getState().toast(error instanceof Error ? error.message : "Printing failed.", "error");
    }
  }, [getBytes]);

  const runSearch = useCallback(async () => {
    const workspace = useWorkspace.getState();
    const current = activeDocumentMeta(workspace);
    const query = searchQuery.trim();
    if (!query) return;
    const openDocIds = [...new Set(workspace.panes.flatMap((pane) => pane.tabs))];
    const targetDocIds = searchScope === "all" ? openDocIds : current ? [current.id] : [];
    if (targetDocIds.length === 0) return;
    setSearchBusy(true);
    setHits([]);
    const found: SearchHit[] = [];
    const needle = query.toLowerCase();
    try {
      for (const docId of targetDocIds) {
        if (found.length >= 300) break;
        const targetDoc = workspace.documents[docId];
        if (!targetDoc) continue;
        try {
          const bytes = await getBytes(docId);
          const loaded = await loadPdf(`search-${docId}-${Date.now()}`, async () => bytes);
          for (let pageNumber = 1; pageNumber <= loaded.pdf.numPages && found.length < 300; pageNumber += 1) {
            const page = await loaded.pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            const text = content.items
              .filter((item): item is typeof item & { str: string } => "str" in item && item.str.length > 0)
              .map((item) => item.str)
              .join(" ");
            let index = text.toLowerCase().indexOf(needle);
            while (index >= 0 && found.length < 300) {
              found.push({
                docId,
                pageIndex: pageNumber - 1,
                index,
                snippet: `${text.slice(Math.max(0, index - 40), index).trim()}${text.slice(index, index + needle.length)}${text.slice(index + needle.length, index + needle.length + 40).trim()}`,
              });
              index = text.toLowerCase().indexOf(needle, index + needle.length);
            }
          }
          await loaded.cleanup();
        } catch {
          // A damaged document should not prevent results from the remaining tabs.
        }
      }
      setHits(found);
      if (found.length === 0) useWorkspace.getState().toast(`No matches for “${query}”.`, "info");
    } catch (error) {
      useWorkspace.getState().toast(error instanceof Error ? error.message : "Search failed.", "error");
    } finally {
      setSearchBusy(false);
    }
  }, [getBytes, searchQuery, searchScope]);

  const insertImage = useCallback(() => {
    if (!activeDocumentMeta(useWorkspace.getState())) return;
    imageInputRef.current?.click();
  }, []);

  const handleImageChosen = useCallback(
    async (file: File) => {
      const current = activeDocumentMeta(useWorkspace.getState());
      if (!current) return;
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("The image could not be read."));
          reader.readAsDataURL(file);
        });
        const image = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve({ width: element.naturalWidth, height: element.naturalHeight });
          element.onerror = () => reject(new Error("The image could not be decoded."));
          element.src = dataUrl;
        });
        const bytes = await getBytes(current.id);
        const loaded = await loadPdf(`image-page-${current.id}`, async () => bytes);
        const currentPane = activePane(useWorkspace.getState());
        const page = await loaded.pdf.getPage(currentPane.view.page);
        const pageSize = getPageSize(page, 0);
        await loaded.cleanup();
        const targetWidth = Math.min(pageSize.width * 0.45, 240);
        const targetHeight = (image.height / image.width) * targetWidth;
        const x = (pageSize.width - targetWidth) / 2;
        const y = (pageSize.height - targetHeight) / 2;
        const annotation = createAnnotation({
          docId: current.id,
          pageIndex: currentPane.view.page - 1,
          kind: "image",
          color: "#ffffff",
          opacity: 1,
          strokeWidth: 0,
          points: [
            { x, y },
            { x: x + targetWidth, y: y + targetHeight },
          ],
          imageData: dataUrl,
        });
        useWorkspace.getState().addAnnotation(annotation);
        useWorkspace.getState().toast("Reference image placed at the centre of the page.", "success");
      } catch (error) {
        useWorkspace.getState().toast(error instanceof Error ? error.message : "Could not insert the image.", "error");
      }
    },
    [getBytes],
  );

  const openNoteForAnnotation = useCallback((annotation: Annotation) => {
    const workspace = useWorkspace.getState();
    const current = activeDocumentMeta(workspace);
    if (!current) return;
    const noteId = workspace.addNote({
      title: annotation.text ? annotation.text.slice(0, 40) : `Note on page ${annotation.pageIndex + 1}`,
      body: annotation.text ? `> ${annotation.text}\n\n` : "",
      links: [
        {
          id: `link-${Date.now()}`,
          docId: current.id,
          docName: current.name,
          pageIndex: annotation.pageIndex,
          annotationId: annotation.id,
        },
      ],
    });
    workspace.setActiveNote(noteId);
    workspace.setRightPanel("notes");
  }, []);

  const quoteSelection = useCallback((text: string, pageIndex: number) => {
    const workspace = useWorkspace.getState();
    const current = activeDocumentMeta(workspace);
    const quote = text.replace(/\s+/g, " ").trim();
    if (!current || !quote) return;
    const noteId = workspace.addNote({
      title: `Quote — page ${pageIndex + 1}`,
      body: `> ${quote}\n\n`,
      links: [
        {
          id: `link-${Date.now()}`,
          docId: current.id,
          docName: current.name,
          pageIndex,
        },
      ],
    });
    workspace.setActiveNote(noteId);
    workspace.setRightPanel("notes");
    workspace.setSidebar("notes");
    workspace.toast("Passage added to the notebook.", "success");
  }, []);

  const commands: Command[] = useMemo(
    () => [
      { id: "open", label: "Open PDF", shortcut: "Ctrl+O", run: () => void openFiles() },
      { id: "demo", label: "Open interactive sample", run: () => void openDemo() },
      ...recentFiles.map((recent) => ({
        id: `recent-${recent.path}`,
        label: `Open recent: ${recent.name}`,
        run: () => void openRecent(recent.path),
      })),
      { id: "save", label: "Save annotated copy", shortcut: "Ctrl+S", run: () => void saveCurrent() },
      { id: "export", label: "Export document…", shortcut: "Ctrl+Shift+E", run: () => useUi.getState().openModal("export") },
      { id: "print", label: "Print", shortcut: "Ctrl+P", run: () => void printDocument() },
      { id: "split", label: "Split pane", shortcut: "Ctrl+\\", run: () => state.splitPane(state.activePaneId) },
      { id: "sidebar", label: "Toggle navigation sidebar", run: () => state.toggleSidebar() },
      { id: "notes", label: "Open notebook", run: () => { state.setSidebar("notes"); state.setRightPanel("notes"); } },
      { id: "markup", label: "Open markup list", run: () => state.setRightPanel("markup") },
      { id: "organize", label: "Organize pages…", run: () => useUi.getState().openModal("organize") },
      { id: "fit-width", label: "Fit page width", shortcut: "Ctrl+1", run: () => state.setZoom(pane.id, 1, "fit-width") },
      { id: "fit-page", label: "Fit whole page", shortcut: "Ctrl+2", run: () => state.setZoom(pane.id, 1, "fit-page") },
      { id: "theme", label: "Toggle theme", run: () => state.toggleTheme() },
      { id: "focus", label: "Toggle distraction-free mode", shortcut: "F11", run: () => state.toggleFocusMode() },
      { id: "shortcuts", label: "Keyboard shortcuts", shortcut: "F1", run: () => useUi.getState().openModal("shortcuts") },
      { id: "search", label: "Search in document", shortcut: "Ctrl+F", run: () => state.setSidebar("search") },
    ],
    [openDemo, openFiles, openRecent, pane.id, printDocument, recentFiles, saveCurrent, state],
  );

  const handlers = useMemo(
    () => ({
      open: () => void openFiles(),
      save: () => void saveCurrent(),
      saveAs: () => void saveAs(),
      exportFile: () => useUi.getState().openModal("export"),
      print: () => void printDocument(),
      find: () => state.setSidebar("search"),
      commandPalette: () => setCommandOpen(true),
      toggleShortcuts: () => useUi.getState().openModal("shortcuts"),
      insertImage: () => insertImage(),
    }),
    [insertImage, openFiles, printDocument, saveAs, saveCurrent, setCommandOpen, state],
  );
  useKeyboard(handlers);

  const onJumpToLink = useCallback((link: NoteLink) => {
    const workspace = useWorkspace.getState();
    if (link.docId !== workspace.panes.find((p) => p.id === workspace.activePaneId)?.activeDocId) {
      const paneWithDoc = workspace.panes.find((p) => p.tabs.includes(link.docId));
      if (paneWithDoc) workspace.setActiveTab(paneWithDoc.id, link.docId);
    }
    const document = workspace.documents[link.docId];
    const target = useWorkspace.getState().panes.find((p) => p.activeDocId === link.docId) ?? activePane(useWorkspace.getState());
    if (document) useWorkspace.getState().setPage(target.id, link.pageIndex + 1, document.pageCount);
  }, []);

  const jumpToAnnotation = useCallback((annotation: Annotation) => {
    const workspace = useWorkspace.getState();
    const document = workspace.documents[annotation.docId];
    if (!document) return;
    workspace.setPage(workspace.activePaneId, annotation.pageIndex + 1, document.pageCount);
  }, []);

  if (!ready) {
    return (
      <div className="boot-screen" role="status">
        <ReadGlyph />
        <p>Preparing the reading workspace…</p>
      </div>
    );
  }

  return (
    <div
      className={`app${state.focusMode ? " focus-mode" : ""}${dropActive ? " drop-active" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        const files = Array.from(event.dataTransfer.files);
        void (async () => {
          const entries = [];
          for (const file of files) {
            if (!/\.pdf$/i.test(file.name)) continue;
            entries.push({ path: file.name, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
          }
          await ingest(entries);
        })();
      }}
    >
      <AppMenuBar
        activeDoc={doc}
        recentFiles={recentFiles}
        onOpen={() => void openFiles()}
        onOpenDemo={() => void openDemo()}
        onOpenRecent={(path) => void openRecent(path)}
        onClearRecent={() => {
          clearRecentFiles();
          setRecentFiles([]);
        }}
        onSave={() => void saveCurrent()}
        onExport={() => useUi.getState().openModal("export")}
        onPrint={() => void printDocument()}
        onInsertImage={insertImage}
      />

      <nav className="tabbar" aria-label="Open documents">
        {pane.tabs.map((docId) => {
          const tabDoc = state.documents[docId];
          if (!tabDoc) return null;
          return (
            <div
              key={docId}
              className="tab"
              role="tab"
              aria-selected={pane.activeDocId === docId}
              tabIndex={0}
              onClick={() => state.setActiveTab(pane.id, docId)}
              onContextMenu={(event) => {
                event.preventDefault();
                state.setActiveTab(pane.id, docId);
                setTabMenu({ docId, x: event.clientX, y: event.clientY });
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  state.closeTab(pane.id, docId);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") state.setActiveTab(pane.id, docId);
              }}
            >
              <BookOpen size={12} />
              <span className="tab-name" title={tabDoc.name}>{tabDoc.name}</span>
              <button
                className="tab-close"
                aria-label={`Close ${tabDoc.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  state.closeTab(pane.id, docId);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button className="tab-new" aria-label="Open PDF" title="Open PDF (Ctrl+O)" onClick={() => void openFiles()}>
          +
        </button>
      </nav>
      {tabMenu && (
        <div
          ref={tabMenuRef}
          className="tab-context-menu"
          role="menu"
          aria-label="Tab actions"
          style={{ left: Math.min(tabMenu.x, window.innerWidth - 190), top: Math.min(tabMenu.y, window.innerHeight - 130) }}
        >
          <button role="menuitem" onClick={() => { state.closeTab(pane.id, tabMenu.docId); setTabMenu(null); }}>
            Close tab
          </button>
          <button role="menuitem" disabled={pane.tabs.length <= 1} onClick={() => { state.closeOtherTabs(pane.id, tabMenu.docId); setTabMenu(null); }}>
            Close other tabs
          </button>
          <button role="menuitem" onClick={() => { state.closeAllTabs(pane.id); setTabMenu(null); }}>
            Close all tabs
          </button>
        </div>
      )}

      <div className="workspace-body">
        {state.sidebarOpen && (
          <Sidebar
            state={state}
            doc={doc}
            getBytes={getBytes}
            hits={hits}
            query={searchQuery}
            searchBusy={searchBusy}
            searchScope={searchScope}
            onSearchScope={setSearchScope}
            onQuery={setSearchQuery}
            onSearch={() => void runSearch()}
            onOpenHit={(hit) => {
              const workspace = useWorkspace.getState();
              const targetDoc = workspace.documents[hit.docId];
              if (!targetDoc) return;
              const targetPane =
                workspace.panes.find((candidate) => candidate.activeDocId === hit.docId) ??
                workspace.panes.find((candidate) => candidate.tabs.includes(hit.docId));
              if (targetPane) {
                if (targetPane.activeDocId !== hit.docId) {
                  workspace.setActiveTab(targetPane.id, hit.docId);
                } else {
                  workspace.setActivePane(targetPane.id);
                }
                useWorkspace.getState().setPage(targetPane.id, hit.pageIndex + 1, targetDoc.pageCount);
              } else {
                workspace.openDocumentInPane(hit.docId);
                const active = activePane(useWorkspace.getState());
                useWorkspace.getState().setPage(active.id, hit.pageIndex + 1, targetDoc.pageCount);
              }
            }}
            onPageChange={(pageNumber) => doc && state.setPage(pane.id, pageNumber, doc.pageCount)}
            onSelectPanel={(panel) => {
              state.setSidebar(panel);
              if (panel === "notes") state.setRightPanel("notes");
            }}
          />
        )}
        <Workspace
          state={state}
          getBytes={getBytes}
          searchQuery={searchQuery}
          onOpen={() => void openFiles()}
          onSave={() => void saveCurrent()}
          onExport={() => useUi.getState().openModal("export")}
          onPrint={() => void printDocument()}
          onToggleSidebar={() => state.toggleSidebar()}
          onOpenSearch={() => state.setSidebar("search")}
          onInsertImage={insertImage}
          onOpenNoteForAnnotation={openNoteForAnnotation}
          onQuoteSelection={quoteSelection}
        />
        {state.rightPanel === "notes" && (
          <NotesPanel onJumpToLink={onJumpToLink} onClose={() => state.setRightPanel("none")} />
        )}
        {state.rightPanel === "markup" && (
          <AnnotationPanel
            annotations={state.annotations}
            onJump={jumpToAnnotation}
            onClose={() => state.setRightPanel("none")}
          />
        )}
      </div>

      <footer className="statusbar">
        <span className="status-item"><span className="status-dot" /> {opening ? "Opening…" : "Ready"}</span>
        {doc && (
          <>
            <span className="status-item">{doc.pageCount} pages</span>
            <span className="status-item">{formatBytes(doc.size)}</span>
          </>
        )}
        <span className="status-spacer" />
        <span className="status-item">{state.annotations.length} markup</span>
        <span className="status-item">{state.notes.length} notes</span>
        <button
          className="status-item"
          style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}
          onClick={() => state.setRightPanel(state.rightPanel === "markup" ? "none" : "markup")}
          aria-pressed={state.rightPanel === "markup"}
        >
          <PanelRight size={11} /> Markup
        </button>
        <button
          className="status-item"
          style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}
          onClick={() => state.setRightPanel(state.rightPanel === "notes" ? "none" : "notes")}
          aria-pressed={state.rightPanel === "notes"}
        >
          <StickyNote size={11} /> Notes
        </button>
        <span className="status-item">{isDesktop() ? "Desktop" : "Preview"}</span>
      </footer>

      {dropActive && <div className="drop-overlay">Drop PDFs to open them in the active pane</div>}
      {modal === "export" && <ExportDialog />}
      {modal === "organize" && (
        <Suspense fallback={<div className="modal-scrim"><div className="empty-state">Loading page organizer…</div></div>}>
          <PageOrganizer
            onApply={async (bytes, name) => {
              await ingest([{ path: name, name, bytes }]);
              useWorkspace.getState().toast("Created an edited copy with the new page order.", "success");
            }}
          />
        </Suspense>
      )}
      {modal === "shortcuts" && <ShortcutSheet onClose={closeModal} />}
      {modal === "settings" && <SettingsDialog onClose={closeModal} />}
      {passwordRequest && (
        <PasswordDialog
          key={passwordRequest.id}
          label={passwordRequest.label}
          incorrect={passwordRequest.incorrect}
          onSubmit={(password) => {
            const request = passwordRequest;
            setPasswordRequest(null);
            request.resolve(password);
          }}
          onCancel={() => {
            const request = passwordRequest;
            setPasswordRequest(null);
            request.resolve(null);
          }}
        />
      )}
      {commandOpen && <CommandPalette commands={commands} onClose={() => setCommandOpen(false)} />}

      <div className="toast-stack" aria-live="polite">
        {state.toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            <span className="toast-icon">
              {toast.kind === "success" ? <CheckCircle2 size={15} /> : toast.kind === "error" ? <AlertTriangle size={15} /> : <Info size={15} />}
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" multiple className="visually-hidden" onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        void (async () => {
          const entries = [];
          for (const file of files) entries.push({ path: file.name, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
          await ingest(entries);
        })();
      }} />
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void handleImageChosen(file);
      }} />
    </div>
  );
}

async function getDocumentBytesFor(path: string): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  const data = await invoke<ArrayBuffer | number[]>("read_file", { path });
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
}

function PasswordDialog({
  label,
  incorrect,
  onSubmit,
  onCancel,
}: {
  label: string;
  incorrect: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const dialogRef = useModalFocus<HTMLDivElement>(onCancel);
  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="modal password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-title" ref={dialogRef} tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="password-title">Password required</h2>
            <p className="modal-description" title={label}>{label} is protected. Enter its password to open it.</p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password.trim()) onSubmit(password);
          }}
        >
          <div className="modal-content">
            {incorrect && <div className="form-error" role="alert">That password was not accepted. Try again.</div>}
            <label className="field-label" htmlFor="pdf-password">Password</label>
            <input
              id="pdf-password"
              className="search-input"
              type="password"
              autoComplete="off"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="hint">The password stays in memory for this session and is never written to disk.</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onCancel}>Cancel</button>
            <button type="submit" className="button-primary" disabled={!password.trim()}>Unlock PDF</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {  const theme = useWorkspace((s) => s.theme);
  const toggleTheme = useWorkspace((s) => s.toggleTheme);
  const syncScroll = useWorkspace((s) => s.syncScroll);
  const toggleSyncScroll = useWorkspace((s) => s.toggleSyncScroll);
  const toolOpacity = useWorkspace((s) => s.toolOpacity);
  const setToolOpacity = useWorkspace((s) => s.setToolOpacity);
  const toast = useWorkspace((s) => s.toast);
  const [capabilities, setCapabilities] = useState<{
    version?: string;
    os?: string;
    arch?: string;
    pdfium?: boolean;
    libreoffice?: boolean;
    tesseract?: boolean;
    windows_ocr?: boolean;
    ocr?: boolean;
  } | null>(null);
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);
  useEffect(() => {
    if (!isDesktop()) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<typeof capabilities>("get_platform_info"))
      .then((info) => setCapabilities(info))
      .catch(() => undefined);
  }, []);
  const openDefaultApps = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_default_apps");
      toast("Choose PDFreader for PDF documents in Windows Settings.", "info");
    } catch {
      toast("Open Windows Settings → Apps → Default apps to choose PDFreader.", "info");
    }
  };
  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={dialogRef} tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="settings-title">Reading settings</h2>
            <p className="modal-description">Preferences apply to this workspace.</p>
          </div>
          <button className="icon-button" aria-label="Close settings" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="modal-content">
          <div className="check-row">
            <input id="setting-sync" type="checkbox" checked={syncScroll} onChange={toggleSyncScroll} />
            <label htmlFor="setting-sync">Synchronize scrolling between panes showing the same document</label>
          </div>
          <div className="check-row">
            <input id="setting-theme" type="checkbox" checked={theme === "light"} onChange={toggleTheme} />
            <label htmlFor="setting-theme">Use light interface theme</label>
          </div>
          <div className="form-row">
            <label htmlFor="setting-opacity">Default annotation opacity: {Math.round(toolOpacity * 100)}%</label>
            <input id="setting-opacity" type="range" min={20} max={100} step={5} value={toolOpacity * 100} onChange={(event) => setToolOpacity(Number(event.target.value) / 100)} />
          </div>
          <p className="hint">
            PDFreader is offline-first. Documents are read from disk; annotations and notes stay local until you export them.
          </p>
          <div style={{ marginTop: 12 }}>
            <button className="button-secondary" onClick={() => void openDefaultApps()}>
              Choose default PDF app in Windows
            </button>
          </div>
          <div className="capability-panel" aria-label="Component status">
            <div className="capability-row">
              <span>Native PDF engine</span>
              <strong>
                {capabilities === null ? "Checking…" : capabilities.pdfium ? "PDFium 8138" : "PDF.js fallback"}
              </strong>
            </div>
            <div className="capability-row">
              <span>Word 97 conversion</span>
              <strong>{capabilities?.libreoffice ? "LibreOffice available" : "Optional / not installed"}</strong>
            </div>
            <div className="capability-row">
              <span>OCR</span>
              <strong>
                {capabilities?.ocr
                  ? capabilities.tesseract
                    ? "Tesseract available"
                    : capabilities.windows_ocr
                      ? "Windows OCR available"
                      : "Available"
                  : "Optional / not installed"}
              </strong>
            </div>
            {capabilities?.version && (
              <div className="capability-row">
                <span>PDFreader</span>
                <strong>{capabilities.version} · {capabilities.os} {capabilities.arch}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadGlyph() {
  return (
    <svg width="38" height="38" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M5 6.5C7.8 5 10.3 5 14 6.8V22c-3.4-1.6-6.2-1.7-9-.4V6.5Z" fill="currentColor" opacity=".75" />
      <path d="M23 6.5C20.2 5 17.7 5 14 6.8V22c3.4-1.6 6.2-1.7 9-.4V6.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
