import { Bookmark, BookOpen, ListTree, Search, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DocumentMeta, OutlineNode, SearchHit } from "../../types";
import { ThumbnailStrip } from "../viewer/ThumbnailStrip";
import { loadPdf } from "../viewer/pdfjs";
import type { WorkspaceState } from "./store";

type Props = {
  state: WorkspaceState;
  doc: DocumentMeta | undefined;
  getBytes: (docId: string) => Promise<Uint8Array>;
  hits: SearchHit[];
  query: string;
  searchBusy: boolean;
  onQuery: (query: string) => void;
  onSearch: () => void;
  searchScope: "current" | "all";
  onSearchScope: (scope: "current" | "all") => void;
  onOpenHit: (hit: SearchHit) => void;
  onPageChange: (page: number) => void;
  onSelectPanel: (panel: WorkspaceState["sidebar"]) => void;
};

export function Sidebar({
  state,
  doc,
  getBytes,
  hits,
  query,
  searchBusy,
  onQuery,
  onSearch,
  searchScope,
  onSearchScope,
  onOpenHit,
  onPageChange,
  onSelectPanel,
}: Props) {
  const page = state.panes.find((pane) => pane.id === state.activePaneId)?.view.page ?? 1;
  const [bookmarkLabel, setBookmarkLabel] = useState("");
  const docBookmarks = doc
    ? state.bookmarks
        .filter((bookmark) => bookmark.docId === doc.id)
        .sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt)
    : [];
  return (
    <aside className="sidebar" aria-label="Document navigation">
      <div className="sidebar-tabs" role="tablist" aria-label="Navigation panels">
        <button
          className="sidebar-tab"
          role="tab"
          aria-selected={state.sidebar === "thumbnails"}
          aria-label="Page thumbnails"
          title="Thumbnails"
          onClick={() => onSelectPanel("thumbnails")}
        >
          <BookOpen size={15} />
        </button>
        <button
          className="sidebar-tab"
          role="tab"
          aria-selected={state.sidebar === "outline"}
          aria-label="Document outline"
          title="Outline"
          onClick={() => onSelectPanel("outline")}
        >
          <ListTree size={15} />
        </button>
        <button
          className="sidebar-tab"
          role="tab"
          aria-selected={state.sidebar === "search"}
          aria-label="Search document"
          title="Search"
          onClick={() => onSelectPanel("search")}
        >
          <Search size={15} />
        </button>
        <button
          className="sidebar-tab"
          role="tab"
          aria-selected={state.sidebar === "bookmarks"}
          aria-label="Page bookmarks"
          title="Bookmarks"
          onClick={() => onSelectPanel("bookmarks")}
        >
          <Bookmark size={15} />
        </button>
        <button
          className="sidebar-tab"
          role="tab"
          aria-selected={state.sidebar === "notes"}
          aria-label="Reading notes"
          title="Notes"
          onClick={() => onSelectPanel("notes")}
        >
          <StickyNote size={15} />
        </button>
      </div>
      <div className="sidebar-content">
        {!doc ? (
          <div className="empty-state">
            <BookOpen size={24} />
            <p>Open a PDF to see pages, outline, search, and notes here.</p>
          </div>
        ) : state.sidebar === "thumbnails" ? (
          <>
            <div className="sidebar-heading"><span>PAGES</span><span>{doc.pageCount}</span></div>
            <ThumbnailStrip doc={doc} getBytes={getBytes} currentPage={page} onPageChange={onPageChange} />
          </>
        ) : state.sidebar === "outline" ? (
          <>
            <div className="sidebar-heading"><span>OUTLINE</span></div>
            <DocumentOutline doc={doc} getBytes={getBytes} onPageChange={onPageChange} currentPage={page} />
          </>
        ) : state.sidebar === "search" ? (
          <>
            <div className="sidebar-heading"><span>SEARCH</span></div>
            <div className="search-scope" role="group" aria-label="Search scope">
              <button
                className={`search-scope-button${searchScope === "current" ? " selected" : ""}`}
                aria-pressed={searchScope === "current"}
                onClick={() => onSearchScope("current")}
              >
                This PDF
              </button>
              <button
                className={`search-scope-button${searchScope === "all" ? " selected" : ""}`}
                aria-pressed={searchScope === "all"}
                onClick={() => onSearchScope("all")}
              >
                All open
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSearch();
              }}
            >
              <input
                className="search-input"
                aria-label="Search this document"
                placeholder={searchScope === "all" ? "Find across open PDFs" : "Find in document"}
                value={query}
                onChange={(event) => onQuery(event.target.value)}
              />
            </form>
            <div style={{ marginTop: 9 }} className="search-list" aria-live="polite">
              {searchBusy && <div className="empty-state">Searching…</div>}
              {!searchBusy && query && hits.length === 0 && <div className="empty-state">No matches for “{query}”.</div>}
              {hits.map((hit) => (
                <button key={`${hit.docId}-${hit.pageIndex}-${hit.index}`} className="search-result" onClick={() => onOpenHit(hit)}>
                  Page {hit.pageIndex + 1}
                  <span className="meta">
                    {searchScope === "all" ? `${state.documents[hit.docId]?.name ?? "Document"} · ` : ""}
                    {hit.snippet}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : state.sidebar === "bookmarks" ? (
          <>
            <div className="sidebar-heading"><span>BOOKMARKS</span><span>{docBookmarks.length}</span></div>
            <form
              className="bookmark-form"
              onSubmit={(event) => {
                event.preventDefault();
                const label = bookmarkLabel.trim() || `Page ${page}`;
                state.addBookmark(doc.id, page - 1, label);
                state.toast(`Bookmarked page ${page}.`, "success");
                setBookmarkLabel("");
              }}
            >
              <input
                className="search-input"
                aria-label="Bookmark label"
                placeholder={`Label for page ${page} (optional)`}
                value={bookmarkLabel}
                onChange={(event) => setBookmarkLabel(event.target.value)}
              />
              <button type="submit" className="button-primary" style={{ minHeight: 27, padding: "4px 8px", fontSize: 10 }}>
                <Bookmark size={11} /> Add page {page}
              </button>
            </form>
            {docBookmarks.length === 0 ? (
              <div className="empty-state">No bookmarks yet. Bookmark the current page to return to it later.</div>
            ) : (
              <ul className="bookmark-list">
                {docBookmarks.map((bookmark) => (
                  <li key={bookmark.id} className="bookmark-row">
                    <button className="bookmark-jump" onClick={() => onPageChange(bookmark.pageIndex + 1)} title={`Go to page ${bookmark.pageIndex + 1}`}>
                      <Bookmark size={11} />
                      <span>{bookmark.label}</span>
                      <span className="bookmark-page">p.{bookmark.pageIndex + 1}</span>
                    </button>
                    <button className="icon-button" aria-label={`Delete bookmark ${bookmark.label}`} onClick={() => state.removeBookmark(bookmark.id)}>
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="sidebar-heading"><span>READING NOTES</span><span>{state.notes.length}</span></div>
            <div className="note-list">
              {state.notes.map((note) => (
                <button key={note.id} className="note-list-item" onClick={() => { state.setActiveNote(note.id); state.setSidebar("notes"); }}>
                  {note.title || "Untitled"}
                  <span className="meta">{note.links.length} linked page{note.links.length === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

type RawOutlineItem = {
  title: string;
  dest: string | unknown[] | null;
  bold?: boolean;
  italic?: boolean;
  items?: RawOutlineItem[];
};

function DocumentOutline({
  doc,
  getBytes,
  currentPage,
  onPageChange,
}: {
  doc: DocumentMeta;
  getBytes: (docId: string) => Promise<Uint8Array>;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOutline(null);
    const load = async () => {
      try {
        const loaded = await loadPdf(doc.id, () => getBytes(doc.id));
        const raw = (await loaded.pdf.getOutline()) as RawOutlineItem[] | null;
        if (!raw) {
          if (!cancelled) setOutline([]);
          return;
        }
        const resolvePage = async (item: RawOutlineItem): Promise<number> => {
          try {
            let dest = item.dest;
            if (typeof dest === "string") dest = await loaded.pdf.getDestination(dest);
            if (Array.isArray(dest) && dest[0] && typeof dest[0] === "object") {
              const pageIndex = await loaded.pdf.getPageIndex(dest[0] as never);
              return pageIndex + 1;
            }
          } catch {
            // Some outlines use actions or broken destinations; show them as bookmarks without a page.
          }
          return 1;
        };
        const convert = async (items: RawOutlineItem[]): Promise<OutlineNode[]> => {
          const results: OutlineNode[] = [];
          for (const item of items) {
            results.push({
              title: item.title,
              pageIndex: (await resolvePage(item)) - 1,
              bold: item.bold,
              italic: item.italic,
              children: item.items ? await convert(item.items) : [],
            });
          }
          return results;
        };
        const converted = await convert(raw);
        if (!cancelled) setOutline(converted);
      } catch {
        if (!cancelled) setOutline([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [doc.id, getBytes]);

  if (loading) return <div className="empty-state">Reading outline…</div>;
  if (!outline || outline.length === 0) {
    return (
      <p className="empty-state" style={{ padding: "14px 4px" }}>
        This document has no authored outline. Page thumbnails and search remain available.
      </p>
    );
  }

  const renderNodes = (nodes: OutlineNode[], depth = 0): React.ReactNode => (
    <ul className="outline-list" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {nodes.map((node, index) => (
        <li key={`${node.title}-${index}-${depth}`}>
          <button
            className="outline-item"
            style={{ fontWeight: node.bold ? 600 : 400, fontStyle: node.italic ? "italic" : "normal" }}
            aria-current={node.pageIndex + 1 === currentPage ? "location" : undefined}
            onClick={() => onPageChange(node.pageIndex + 1)}
            title={`Page ${node.pageIndex + 1}`}
          >
            {node.title || `Page ${node.pageIndex + 1}`}
          </button>
          {node.children.length > 0 && renderNodes(node.children, depth + 1)}
        </li>
      ))}
    </ul>
  );

  return <>{renderNodes(outline)}</>;
}
