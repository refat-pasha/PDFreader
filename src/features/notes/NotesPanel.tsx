import { useEffect, useRef } from "react";
import { ExternalLink, Download, Link2, Plus, Trash2, X } from "lucide-react";
import { useWorkspace, activeDocumentMeta, type NoteLink } from "../workspace/store";
import { renderMarkdown, noteExcerpt } from "./markdown";
import { notesFilename, notesToMarkdown } from "./exportNotes";
import { writeTextFile } from "../../app/fileService";

type Props = {
  onJumpToLink: (link: NoteLink) => void;
  onClose: () => void;
};

export function NotesPanel({ onJumpToLink, onClose }: Props) {
  const notes = useWorkspace((state) => state.notes);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const addNote = useWorkspace((state) => state.addNote);
  const updateNote = useWorkspace((state) => state.updateNote);
  const deleteNote = useWorkspace((state) => state.deleteNote);
  const setActiveNote = useWorkspace((state) => state.setActiveNote);
  const toast = useWorkspace((state) => state.toast);
  const activeDoc = useWorkspace((state) => activeDocumentMeta(state));
  const activePage = useWorkspace(
    (state) => state.panes.find((pane) => pane.id === state.activePaneId)?.view.page ?? 1,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0];

  useEffect(() => {
    if (!activeNoteId && notes[0]) setActiveNote(notes[0].id);
  }, [activeNoteId, notes, setActiveNote]);

  const linkCurrentPage = () => {
    if (!activeDoc) return;
    const noteId = activeNote?.id ?? addNote({ title: "Reading note" });
    const note = useWorkspace.getState().notes.find((n) => n.id === noteId);
    if (!note) return;
    const link: NoteLink = {
      id: `link-${Date.now()}`,
      docId: activeDoc.id,
      docName: activeDoc.name,
      pageIndex: activePage - 1,
    };
    updateNote(noteId, { links: [...note.links, link] });
  };

  const insertLinkedReference = () => {
    if (!activeDoc || !activeNote) return;
    linkCurrentPage();
    const reference = `\n\n> ${activeDoc.name}, page ${activePage}\n`;
    updateNote(activeNote.id, { body: `${activeNote.body}${reference}` });
    textareaRef.current?.focus();
  };

  return (
    <aside className="notes-panel" aria-label="Notes">
      <div className="panel-header">
        <span className="panel-title">NOTES</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            className="icon-button"
            aria-label="Export all notes as Markdown"
            title="Export all notes as Markdown"
            onClick={() => {
              void writeTextFile(notesToMarkdown(notes), notesFilename())
                .then((destination) => {
                  if (destination) toast(`Exported notebook to ${destination}`, "success");
                })
                .catch((error: unknown) => {
                  toast(error instanceof Error ? error.message : "The notebook could not be exported.", "error");
                });
            }}
          >
            <Download size={15} />
          </button>
          <button className="icon-button" aria-label="New note" title="New note" onClick={() => addNote({ title: "New note" })}>
            <Plus size={15} />
          </button>
          <button className="icon-button" aria-label="Close notes" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="note-list" style={{ marginBottom: 10 }}>
          {notes.slice(0, 6).map((note) => (
            <button
              key={note.id}
              className="note-list-item"
              aria-current={activeNote?.id === note.id ? "true" : undefined}
              style={activeNote?.id === note.id ? { background: "var(--accent-soft)", color: "var(--text)" } : undefined}
              onClick={() => setActiveNote(note.id)}
            >
              {note.title || "Untitled"}
              <span className="meta">{noteExcerpt(note.body, 70) || "Empty note"}</span>
            </button>
          ))}
        </div>
        {activeNote ? (
          <>
            <input
              className="note-title-input"
              aria-label="Note title"
              value={activeNote.title}
              onChange={(event) => updateNote(activeNote.id, { title: event.target.value })}
            />
            <textarea
              ref={textareaRef}
              className="note-editor"
              aria-label="Note body"
              rows={9}
              value={activeNote.body}
              placeholder="Write in Markdown. Link this note to the current page with the link button."
              onChange={(event) => updateNote(activeNote.id, { body: event.target.value })}
            />
            <div className="note-backlinks">
              {activeNote.links.map((link) => (
                <button key={link.id} className="note-backlink" onClick={() => onJumpToLink(link)} title={`Open ${link.docName}, page ${link.pageIndex + 1}`}>
                  <ExternalLink size={10} />
                  {link.docName.replace(/\.pdf$/i, "")} · p.{link.pageIndex + 1}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
              <button className="button-secondary" style={{ flex: 1, minHeight: 26, padding: "3px 7px", fontSize: 10 }} disabled={!activeDoc} onClick={linkCurrentPage}>
                <Link2 size={11} /> Link page
              </button>
              <button className="button-secondary" style={{ flex: 1, minHeight: 26, padding: "3px 7px", fontSize: 10 }} disabled={!activeDoc} onClick={insertLinkedReference}>
                <Link2 size={11} /> Reference
              </button>
              <button
                className="icon-button"
                aria-label="Delete note"
                title="Delete note"
                onClick={() => activeNote && deleteNote(activeNote.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="note-preview" aria-label="Note preview">
              {renderMarkdown(activeNote.body)}
            </div>
          </>
        ) : (
          <div className="empty-state">No notes yet. Create one to keep your reading beside the document.</div>
        )}
      </div>
    </aside>
  );
}
