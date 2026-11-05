import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Clock3,
  Columns2,
  Download,
  FilePlus2,
  FolderOpen,
  Keyboard,
  LayoutGrid,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Printer,
  Save,
  Settings,
  StickyNote,
  Sun,
  Undo2,
  Redo2,
} from "lucide-react";
import type { DocumentMeta } from "../../types";
import type { RecentFile } from "../../app/recentFiles";
import { activeDocumentMeta, useWorkspace } from "../workspace/store";
import { useUi } from "./uiStore";

type Props = {
  activeDoc?: DocumentMeta;
  recentFiles: RecentFile[];
  onOpen: () => void;
  onOpenDemo: () => void;
  onOpenRecent: (path: string) => void;
  onClearRecent: () => void;
  onSave: () => void;
  onExport: () => void;
  onPrint: () => void;
  onInsertImage: () => void;
};

function MenuAction({
  label,
  shortcut,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className="menu-action"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function AppMenuBar({
  activeDoc,
  recentFiles,
  onOpen,
  onOpenDemo,
  onOpenRecent,
  onClearRecent,
  onSave,
  onExport,
  onPrint,
  onInsertImage,
}: Props) {
  const theme = useWorkspace((state) => state.theme);
  const toggleTheme = useWorkspace((state) => state.toggleTheme);
  const toggleFocus = useWorkspace((state) => state.toggleFocusMode);
  const focusMode = useWorkspace((state) => state.focusMode);
  const sidebarOpen = useWorkspace((state) => state.sidebarOpen);
  const toggleSidebar = useWorkspace((state) => state.toggleSidebar);
  const splitPane = useWorkspace((state) => state.splitPane);
  const activePaneId = useWorkspace((state) => state.activePaneId);
  const openModal = useUi((state) => state.openModal);
  const setCommandOpen = useUi((state) => state.setCommandOpen);
  const [recentOpen, setRecentOpen] = useState(false);
  const recentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recentOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!recentRef.current?.contains(event.target as Node)) setRecentOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecentOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [recentOpen]);

  return (
    <header className="app-menubar">
      <div className="brand-mark">
        <span className="brand-glyph" aria-hidden="true">
          <ReadMark />
        </span>
        <span>PDFreader</span>
      </div>
      <MenuAction label="Open" shortcut="Ctrl+O" onClick={onOpen}>
        <FolderOpen size={14} />
      </MenuAction>
      <div className="recent-menu-wrap" ref={recentRef}>
        <button
          className={`menu-action${recentOpen ? " menu-action-active" : ""}`}
          aria-label="Recent files"
          title="Recent files"
          aria-haspopup="menu"
          aria-expanded={recentOpen}
          onClick={() => setRecentOpen((open) => !open)}
        >
          <Clock3 size={14} />
          <span>Recent</span>
        </button>
        {recentOpen && (
          <div className="recent-menu" role="menu" aria-label="Recent files">
            {recentFiles.length === 0 ? (
              <div className="recent-empty">No recent files yet.</div>
            ) : (
              <>
                {recentFiles.map((recent) => (
                  <button
                    key={recent.path}
                    className="recent-item"
                    role="menuitem"
                    title={recent.path}
                    onClick={() => {
                      setRecentOpen(false);
                      onOpenRecent(recent.path);
                    }}
                  >
                    <FilePlus2 size={12} />
                    <span>{recent.name}</span>
                  </button>
                ))}
                <button className="recent-clear" role="menuitem" onClick={() => { onClearRecent(); setRecentOpen(false); }}>
                  Clear recent files
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <MenuAction label="Save" shortcut="Ctrl+S" onClick={onSave} disabled={!activeDoc}>
        <Save size={14} />
      </MenuAction>
      <MenuAction label="Export" shortcut="Ctrl+Shift+E" onClick={onExport} disabled={!activeDoc}>
        <Download size={14} />
      </MenuAction>
      <MenuAction label="Print" shortcut="Ctrl+P" onClick={onPrint} disabled={!activeDoc}>
        <Printer size={14} />
      </MenuAction>
      <span className="menu-separator" />
      <MenuAction label="Undo" onClick={() => activeDoc && useWorkspace.getState().undo(activeDoc.id)} disabled={!activeDoc}>
        <Undo2 size={14} />
      </MenuAction>
      <MenuAction label="Redo" onClick={() => activeDoc && useWorkspace.getState().redoAction(activeDoc.id)} disabled={!activeDoc}>
        <Redo2 size={14} />
      </MenuAction>
      <MenuAction label="Split" shortcut="Ctrl+\" onClick={() => splitPane(activePaneId)}>
        <Columns2 size={14} />
      </MenuAction>
      <MenuAction label="Sidebar" active={sidebarOpen} onClick={toggleSidebar}>
        <PanelLeft size={14} />
      </MenuAction>
      <span className="menu-separator" />
      <MenuAction label="Organize" onClick={() => openModal("organize")} disabled={!activeDoc}>
        <LayoutGrid size={14} />
      </MenuAction>
      <MenuAction label="Notes" shortcut="Ctrl+M" onClick={() => { useWorkspace.getState().setSidebar("notes"); useWorkspace.getState().setRightPanel("notes"); }}>
        <StickyNote size={14} />
      </MenuAction>
      <MenuAction label="Insert image" onClick={onInsertImage} disabled={!activeDoc}>
        <FilePlus2 size={14} />
      </MenuAction>
      <div className="menu-spacer" />
      <div className="active-doc-label" title={activeDoc?.name}>
        {activeDoc && <><BookOpen size={12} /> {activeDoc.name}</>}
      </div>
      <MenuAction label={theme === "dark" ? "Light theme" : "Dark theme"} onClick={toggleTheme}>
        {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      </MenuAction>
      <MenuAction label={focusMode ? "Exit focus mode" : "Focus mode"} shortcut="F11" onClick={toggleFocus}>
        <BookOpen size={14} />
      </MenuAction>
      <button className="icon-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (F1)" onClick={() => openModal("shortcuts")}>
        <Keyboard size={15} />
      </button>
      <button className="icon-button" aria-label="Command palette" title="Command palette (Ctrl+K)" onClick={() => setCommandOpen(true)}>
        <MoreHorizontal size={16} />
      </button>
      <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => openModal("settings")}>
        <Settings size={15} />
      </button>
    </header>
  );
}

function ReadMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M5 6.5C7.8 5 10.3 5 14 6.8V22c-3.4-1.6-6.2-1.7-9-.4V6.5Z" fill="currentColor" opacity=".8" />
      <path d="M23 6.5C20.2 5 17.7 5 14 6.8V22c3.4-1.6 6.2-1.7 9-.4V6.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 6.8V22" stroke="currentColor" strokeWidth="1.2" opacity=".5" />
    </svg>
  );
}
