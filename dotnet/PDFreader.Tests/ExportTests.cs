using PDFreader.Core;
using PDFreader.Core.Models;
using Xunit;

namespace PDFreader.Tests;

public class ExportTests : IDisposable
{
    private readonly string _dir;

    public ExportTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), $"pdfreader-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { }
    }

    [Fact]
    public void Notes_markdown_export_contains_titles_and_links()
    {
        var note = new Note
        {
            Id = "n1",
            Title = "Method",
            Body = "Use stratified sampling.",
            Links = new List<NoteLink> { new() { DocId = "d1", DocName = "paper.pdf", PageIndex = 4 } },
        };
        var md = ExportService.NotesToMarkdown(new[] { note }, new DateTime(2026, 11, 5, 12, 0, 0));
        Assert.Contains("# PDFreader notebook", md);
        Assert.Contains("## Method", md);
        Assert.Contains("Use stratified sampling.", md);
        Assert.Contains("- paper.pdf, page 5", md);
    }

    [Fact]
    public void Notes_markdown_export_empty_notebook()
    {
        var md = ExportService.NotesToMarkdown(Array.Empty<Note>(), new DateTime(2026, 11, 5));
        Assert.Contains("_No notes._", md);
    }

    [Fact]
    public void Writes_docx_with_paragraphs()
    {
        var path = Path.Combine(_dir, "out.docx");
        ExportService.WriteDocx(path, "Title", new[] { "First paragraph", "Second paragraph" });
        Assert.True(File.Exists(path));
        Assert.True(new FileInfo(path).Length > 500);
        // Valid ZIP container (docx is a zip)
        using var stream = File.OpenRead(path);
        var buf = new byte[4];
        stream.ReadExactly(buf);
        Assert.Equal(0x50, buf[0]); // 'P'
        Assert.Equal(0x4B, buf[1]); // 'K'
    }

    [Fact]
    public void Persistence_roundtrips_all_stores()
    {
        var customRoot = Path.Combine(_dir, "data");
        Persistence.RootOverride = customRoot;
        try
        {
            var persist = new Persistence();
            persist.SaveRecent(new List<RecentFile> { new() { Path = @"C:\x\a.pdf", Name = "a.pdf" } });
            persist.SaveAnnotations(new List<Annotation> { new()
            {
                Id = "a1", DocId = "d1", PageIndex = 0, Kind = AnnotationKind.Ink, Color = "#000000",
                Points = new List<PointD> { new(1, 2), new(3, 4) },
            } });
            persist.SaveNotes(new List<Note> { new() { Id = "n1", Title = "T", Body = "B" } });
            persist.SaveBookmarks(new List<Bookmark> { new() { Id = "b1", DocId = "d1", PageIndex = 1, Label = "L" } });
            persist.SaveSession(new Persistence.SessionFile
            {
                Paths = new List<string> { @"C:\x\a.pdf" },
                ActivePath = @"C:\x\a.pdf",
                Views = new Dictionary<string, Persistence.SessionView>
                {
                    [@"C:\x\a.pdf"] = new() { Page = 2, Zoom = 1.5, Rotation = 90 },
                },
            });

            Assert.Equal("a.pdf", persist.LoadRecent()[0].Name);
            var ann = Assert.Single(persist.LoadAnnotations());
            Assert.Equal(AnnotationKind.Ink, ann.Kind);
            Assert.Equal(2, ann.Points.Count);
            Assert.Equal("T", persist.LoadNotes()[0].Title);
            Assert.Equal("L", persist.LoadBookmarks()[0].Label);
            var session = persist.LoadSession();
            Assert.NotNull(session);
            Assert.Equal(2, session!.Views[@"C:\x\a.pdf"].Page);
            Assert.Equal(90, session.Views[@"C:\x\a.pdf"].Rotation);
        }
        finally
        {
            Persistence.RootOverride = null;
        }
    }
}
