using PDFreader.Core;
using PDFreader.Core.Models;
using Xunit;

namespace PDFreader.Tests;

public class WorkspaceTests : IDisposable
{
    private readonly Workspace _ws = new();

    public void Dispose() { }

    [Fact]
    public void Open_document_registers_and_activates()
    {
        var doc = _ws.OpenDocument(@"C:\docs\a.pdf", 12);
        Assert.Equal(1, _ws.Documents.Count);
        Assert.Equal("a.pdf", doc.Name);
        Assert.Equal(12, doc.PageCount);
        Assert.Same(doc, _ws.ActiveDocument);
    }

    [Fact]
    public void Opening_same_path_twice_reuses_document()
    {
        var first = _ws.OpenDocument(@"C:\docs\a.pdf", 12);
        var second = _ws.OpenDocument(@"C:\docs\A.PDF", 12);
        Assert.Same(first, second);
        Assert.Equal(1, _ws.Documents.Count);
    }

    [Fact]
    public void Add_and_remove_annotations_with_undo_redo()
    {
        var doc = _ws.OpenDocument(@"C:\docs\a.pdf", 3);
        var ann = new Annotation
        {
            Id = "a1",
            DocId = doc.Id,
            PageIndex = 0,
            Kind = AnnotationKind.Ink,
            Color = "#FF0000",
            Points = new List<PointD> { new(10, 10), new(50, 60) },
        };
        _ws.AddAnnotation(ann);
        Assert.Equal(1, _ws.AnnotationCount(doc.Id));
        Assert.True(_ws.Undo(doc.Id));
        Assert.Equal(0, _ws.AnnotationCount(doc.Id));
        Assert.True(_ws.Redo(doc.Id));
        Assert.Equal(1, _ws.AnnotationCount(doc.Id));
        _ws.RemoveAnnotation("a1");
        Assert.Equal(0, _ws.AnnotationCount(doc.Id));
    }

    [Fact]
    public void Bookmarks_deduplicate_by_page_and_sort()
    {
        var doc = _ws.OpenDocument(@"C:\docs\a.pdf", 10);
        _ws.AddBookmark(doc.Id, 4);
        _ws.AddBookmark(doc.Id, 4, "dup");
        _ws.AddBookmark(doc.Id, 1, "Start");
        var list = _ws.BookmarksFor(doc.Id);
        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].PageIndex);
        Assert.Equal("Start", list[0].Label);
        Assert.Equal("Page 5", list[1].Label);
        _ws.RemoveBookmark(list[0].Id);
        Assert.Single(_ws.BookmarksFor(doc.Id));
    }

    [Fact]
    public void Notes_quote_in_note_adds_backlink()
    {
        var doc = _ws.OpenDocument(@"C:\docs\a.pdf", 5);
        var note = _ws.QuoteInNote(doc, 2, "Important passage");
        Assert.Contains("Important passage", note.Body);
        Assert.Equal("Quote — page 3", note.Title);
        var link = Assert.Single(note.Links);
        Assert.Equal(doc.Id, link.DocId);
        Assert.Equal(2, link.PageIndex);
    }

    [Fact]
    public void Close_document_removes_annotations_and_bookmarks()
    {
        var doc = _ws.OpenDocument(@"C:\docs\a.pdf", 5);
        _ws.AddAnnotation(new Annotation
        {
            Id = "a1", DocId = doc.Id, PageIndex = 0, Kind = AnnotationKind.Rectangle,
            Color = "#000000", Points = new List<PointD> { new(0, 0), new(10, 10) },
        });
        _ws.AddBookmark(doc.Id, 2);
        _ws.CloseDocument(doc.Id);
        Assert.Empty(_ws.Documents);
        Assert.Empty(_ws.Annotations);
        Assert.Empty(_ws.Bookmarks);
        Assert.Null(_ws.ActiveDocument);
    }
}
