using PDFreader.Core;
using PDFreader.Core.Models;
using Xunit;

namespace PDFreader.Tests;

/// <summary>
/// Regression tests for the senior-QA audit fixes (2026-11-15): stable
/// document ids, annotation survival across tab close/reopen, undo isolation,
/// corrupt-JSON quarantine, and flatten-export mark scaling.
/// </summary>
[Collection("PersistenceRoot")]
public class QaAuditRegressionTests
{
    [Fact]
    public void Document_id_is_stable_across_sessions()
    {
        // The old per-session GUID orphaned every annotation on restart.
        var id1 = Workspace.StableDocId(@"D:\Docs\Report.pdf");
        var id2 = Workspace.StableDocId(@"d:\docs\report.PDF");
        Assert.Equal(id1, id2);
        Assert.NotEqual(Workspace.StableDocId(@"D:\Docs\Other.pdf"), id1);
    }

    [Fact]
    public void Annotations_survive_close_and_reopen()
    {
        var ws = new Workspace();
        var doc = ws.OpenDocument(@"C:\docs\b.pdf", 5);
        ws.AddAnnotation(new Annotation
        {
            Id = "a1", DocId = doc.Id, PageIndex = 0,
            Kind = AnnotationKind.Rectangle, Color = "#FF0000",
            Points = new List<PointD> { new(10, 10), new(50, 60) },
        });
        // Close the tab: markup must NOT be deleted (old code RemoveAll'd it).
        ws.CloseDocument(doc.Id);
        Assert.Empty(ws.Documents);
        Assert.Equal(1, ws.Annotations.Count);

        // Reopen: path-stable id reconnects the annotation.
        var reopened = ws.OpenDocument(@"C:\docs\b.pdf", 5);
        Assert.Equal(1, ws.AnnotationCount(reopened.Id));
        Assert.NotEmpty(ws.AnnotationsFor(reopened.Id, 0));
    }

    [Fact]
    public void Annotations_connect_by_stable_id_after_new_workspace()
    {
        // Simulates an app restart: persisted annotations (old session's ids)
        // are imported into a fresh workspace, then the file is opened again.
        var path = @"C:\docs\c.pdf";
        var firstId = Workspace.StableDocId(path);
        var persisted = new Annotation
        {
            Id = "a1", DocId = firstId, PageIndex = 1,
            Kind = AnnotationKind.Ink, Color = "#0000FF",
            Points = new List<PointD> { new(1, 1), new(9, 9) },
        };
        var ws = new Workspace();
        ws.ImportAnnotation(persisted);
        var doc = ws.OpenDocument(path, 3);
        Assert.Equal(firstId, doc.Id);
        Assert.NotEmpty(ws.AnnotationsFor(doc.Id, 1));
    }

    [Fact]
    public void Undo_in_one_doc_does_not_destroy_other_docs_history()
    {
        var ws = new Workspace();
        var a = ws.OpenDocument(@"C:\docs\a.pdf", 2);
        var b = ws.OpenDocument(@"C:\docs\b.pdf", 2);
        ws.AddAnnotation(new Annotation
        {
            Id = "b1", DocId = b.Id, PageIndex = 0,
            Kind = AnnotationKind.Ink, Color = "#00FF00",
            Points = new List<PointD> { new(1, 1), new(2, 2) },
        });
        ws.AddAnnotation(new Annotation
        {
            Id = "a1", DocId = a.Id, PageIndex = 0,
            Kind = AnnotationKind.Ink, Color = "#FF0000",
            Points = new List<PointD> { new(3, 3), new(4, 4) },
        });
        // Undo in A: the old loop POPPED and discarded B's interleaved entry.
        Assert.True(ws.Undo(a.Id));
        Assert.Equal(0, ws.AnnotationCount(a.Id));
        Assert.Equal(1, ws.AnnotationCount(b.Id));
        // B's history must still be intact.
        Assert.True(ws.Undo(b.Id));
        Assert.Equal(0, ws.AnnotationCount(b.Id));
    }

    [Fact]
    public void Corrupt_annotations_json_is_quarantined_not_silently_wiped()
    {
        var root = Path.Combine(Path.GetTempPath(), $"pdfreader-qa-{Guid.NewGuid():N}");
        try
        {
            Persistence.RootOverride = root;
            Directory.CreateDirectory(root);
            var path = Path.Combine(root, "annotations.json");
            File.WriteAllText(path, "{ this is not valid json ][");
            var persistence = new Persistence();
            var loaded = persistence.LoadAnnotations();
            Assert.Empty(loaded);
            // The corrupt file must be renamed aside, NOT left in place where
            // the next SaveAnnotations would have committed the empty list.
            Assert.False(File.Exists(path));
            Assert.NotEmpty(Directory.GetFiles(root, "annotations.json.corrupt-*"));
        }
        finally
        {
            Persistence.RootOverride = null;
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    [Fact]
    public void Valid_annotations_round_trip_through_atomic_save()
    {
        var root = Path.Combine(Path.GetTempPath(), $"pdfreader-qa-{Guid.NewGuid():N}");
        try
        {
            Persistence.RootOverride = root;
            var persistence = new Persistence();
            var annotations = new List<Annotation>
            {
                new()
                {
                    Id = "a1", DocId = Workspace.StableDocId(@"C:\x\p.pdf"), PageIndex = 0,
                    Kind = AnnotationKind.Highlighter, Color = "#7AA2F7", Opacity = 0.35,
                    Points = new List<PointD> { new(10, 10), new(100, 12) },
                },
            };
            persistence.SaveAnnotations(annotations);
            var loaded = persistence.LoadAnnotations();
            Assert.Single(loaded);
            Assert.Equal("a1", loaded[0].Id);
            Assert.Equal(2, loaded[0].Points.Count);
            // No leftover .tmp files after an atomic write.
            Assert.Empty(Directory.GetFiles(root, "*.tmp-*"));
        }
        finally
        {
            Persistence.RootOverride = null;
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
