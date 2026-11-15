using PDFreader.Core.Models;

namespace PDFreader.Core;

/// <summary>
/// Workspace state shared across windows/panes: open documents, per-pane view
/// state, annotations, bookmarks, notes. Pure logic — no WPF types — so it is
/// fully unit-testable.
/// </summary>
public sealed class Workspace
{
    public List<DocumentInfo> Documents { get; } = new();
    public List<Note> Notes { get; } = new();
    public List<Bookmark> Bookmarks { get; } = new();

    private readonly List<Annotation> _annotations = new();
    public IReadOnlyList<Annotation> Annotations => _annotations;

    private readonly Stack<(string docId, Annotation before)> _undo = new();
    private readonly Stack<(string docId, Annotation after)> _redo = new();

    public event Action? StateChanged;

    public DocumentInfo? ActiveDocument { get; private set; }

    public event Action<DocumentInfo?>? ActiveDocumentChanged;

    public DocumentInfo OpenDocument(string path, int pageCount, bool encrypted = false, bool requiresPassword = false)
    {
        var existing = Documents.FirstOrDefault(d => string.Equals(d.Path, path, StringComparison.OrdinalIgnoreCase));
        if (existing is not null)
        {
            SetActiveDocument(existing);
            return existing;
        }
        var info = new DocumentInfo
        {
            // STABLE identity: derived from the normalized path, not a random
            // GUID. Annotations/bookmarks are keyed by DocId and persisted;
            // a per-session GUID orphaned every mark on restart. Same file →
            // same id across sessions, so markup and bookmarks reconnect.
            Id = StableDocId(path),
            Path = path,
            Name = Path.GetFileName(path),
            PageCount = pageCount,
            IsEncrypted = encrypted,
            RequiresPassword = requiresPassword,
        };
        Documents.Add(info);
        SetActiveDocument(info);
        return info;
    }

    /// <summary>Deterministic document id from the case-insensitive path.</summary>
    public static string StableDocId(string path)
    {
        var normalized = path.Trim().ToLowerInvariant().Replace('/', '\\');
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(normalized));
        return $"doc-{Convert.ToHexString(hash)[..24].ToLowerInvariant()}";
    }

    public void CloseDocument(string docId)
    {
        var doc = Documents.FirstOrDefault(d => d.Id == docId);
        if (doc is null) return;
        Documents.Remove(doc);
        // Annotations and bookmarks are deliberately KEPT: closing a tab is a
        // workspace action, not a "delete my markup" action. Persisted records
        // reconnect when the file is opened again (ids are path-stable).
        if (ActiveDocument?.Id == docId)
            SetActiveDocument(Documents.LastOrDefault());
    }

    public void SetActiveDocument(DocumentInfo? doc)
    {
        ActiveDocument = doc;
        ActiveDocumentChanged?.Invoke(doc);
        StateChanged?.Invoke();
    }

    public void UpdatePageCount(string docId, int pageCount)
    {
        var doc = Documents.FirstOrDefault(d => d.Id == docId);
        if (doc is not null) doc.PageCount = pageCount;
        StateChanged?.Invoke();
    }

    // --- Annotations -------------------------------------------------------

    public void AddAnnotation(Annotation annotation)
    {
        _annotations.Add(annotation);
        _undo.Push((annotation.DocId, annotation));
        _redo.Clear();
        StateChanged?.Invoke();
    }

    public void RemoveAnnotation(string annotationId)
    {
        var target = _annotations.FirstOrDefault(a => a.Id == annotationId);
        if (target is null) return;
        _annotations.Remove(target);
        _undo.Push((target.DocId, target));
        _redo.Clear();
        StateChanged?.Invoke();
    }

    public bool Undo(string docId)
    {
        // Scan WITHOUT popping entries of other documents: popping-and-losing
        // interleaved history of doc B when undoing doc A permanently
        // destroyed B's undo stack (senior-QA audit finding). A closed doc's
        // stale entries are skipped in place and simply expire naturally.
        var found = _undo.FirstOrDefault(e => e.docId == docId);
        while (_undo.Count > 0 && found.docId != docId)
        {
            found = _undo.Skip(1).FirstOrDefault(e => e.docId == docId);
            if (found.docId != docId) return false;
        }
        // Pop everything above the target so the stack stays consistent…
        while (_undo.Count > 0 && _undo.Peek().docId != docId)
        {
            var skipped = _undo.Pop();
            _redo.Push((skipped.docId, skipped.before));
        }
        if (_undo.Count == 0) return false;
        var (id, entry) = _undo.Pop();
        if (_annotations.Contains(entry))
        {
            _annotations.Remove(entry);
            _redo.Push((docId, entry));
        }
        else
        {
            _annotations.Add(entry);
            _redo.Push((docId, entry));
        }
        StateChanged?.Invoke();
        return true;
    }

    public bool Redo(string docId)
    {
        var found = _redo.FirstOrDefault(e => e.docId == docId);
        while (_redo.Count > 0 && found.docId != docId)
        {
            found = _redo.Skip(1).FirstOrDefault(e => e.docId == docId);
            if (found.docId != docId) return false;
        }
        while (_redo.Count > 0 && _redo.Peek().docId != docId)
        {
            var skipped = _redo.Pop();
            _undo.Push((skipped.docId, skipped.after));
        }
        if (_redo.Count == 0) return false;
        var (id, entry) = _redo.Pop();
        if (_annotations.Contains(entry))
        {
            _annotations.Remove(entry);
            _undo.Push((docId, entry));
        }
        else
        {
            _annotations.Add(entry);
            _undo.Push((docId, entry));
        }
        StateChanged?.Invoke();
        return true;
    }

    public IReadOnlyList<Annotation> AnnotationsFor(string docId, int pageIndex) =>
        _annotations.Where(a => a.DocId == docId && a.PageIndex == pageIndex).ToList();

    public int AnnotationCount(string docId) => _annotations.Count(a => a.DocId == docId);

    /// <summary>Re-attaches a persisted annotation without touching undo history.</summary>
    public void ImportAnnotation(Annotation annotation)
    {
        if (_annotations.Any(a => a.Id == annotation.Id)) return;
        _annotations.Add(annotation);
    }

    // --- Bookmarks ----------------------------------------------------------

    public Bookmark AddBookmark(string docId, int pageIndex, string? label = null)
    {
        var existing = Bookmarks.FirstOrDefault(b => b.DocId == docId && b.PageIndex == pageIndex);
        if (existing is not null) return existing;
        var bookmark = new Bookmark
        {
            Id = $"bm-{Guid.NewGuid():N}",
            DocId = docId,
            PageIndex = pageIndex,
            Label = string.IsNullOrWhiteSpace(label) ? $"Page {pageIndex + 1}" : label.Trim(),
        };
        Bookmarks.Add(bookmark);
        StateChanged?.Invoke();
        return bookmark;
    }

    public void RemoveBookmark(string bookmarkId) =>
        Bookmarks.RemoveAll(b => b.Id == bookmarkId);

    public IReadOnlyList<Bookmark> BookmarksFor(string docId) =>
        Bookmarks.Where(b => b.DocId == docId).OrderBy(b => b.PageIndex).ToList();

    // --- Notes --------------------------------------------------------------

    public Note AddNote(string title = "New note", string body = "")
    {
        var note = new Note
        {
            Id = $"note-{Guid.NewGuid():N}",
            Title = title,
            Body = body,
        };
        Notes.Add(note);
        StateChanged?.Invoke();
        return note;
    }

    public void DeleteNote(string noteId) =>
        Notes.RemoveAll(n => n.Id == noteId);

    public void TouchNote(Note note)
    {
        note.UpdatedAt = DateTime.UtcNow;
        StateChanged?.Invoke();
    }

    /// <summary>Creates a note quoting a page passage with a backlink.</summary>
    public Note QuoteInNote(DocumentInfo doc, int pageIndex, string quote)
    {
        var note = AddNote(
            title: $"Quote — page {pageIndex + 1}",
            body: $"> {quote.ReplaceLineEndings(" ")}\n\n");
        note.Links.Add(new NoteLink { DocId = doc.Id, DocName = doc.Name, PageIndex = pageIndex });
        return note;
    }
}
