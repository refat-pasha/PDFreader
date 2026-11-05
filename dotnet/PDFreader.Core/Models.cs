namespace PDFreader.Core.Models;

/// <summary>Metadata for one document open in the workspace.</summary>
public sealed class DocumentInfo
{
    public required string Id { get; init; }
    public required string Path { get; init; }
    public required string Name { get; init; }
    public int PageCount { get; set; }
    public bool IsEncrypted { get; set; }
    public bool RequiresPassword { get; set; }
}

/// <summary>View state for one pane showing one document.</summary>
public sealed class ViewState
{
    public int Page { get; set; } = 1;
    public double Zoom { get; set; } = 1.0;
    public int Rotation { get; set; } = 0;
    public ZoomMode Mode { get; set; } = ZoomMode.FitPage;
}

public enum ZoomMode
{
    Custom,
    FitPage,
    FitWidth,
}

public enum AnnotationKind
{
    Ink,
    Highlighter,
    Rectangle,
    Ellipse,
    Arrow,
    Text,
    Note,
    Image,
}

/// <summary>A stored annotation. Geometry is in PDF page points (72dpi), origin top-left.</summary>
public sealed class Annotation
{
    public required string Id { get; init; }
    public required string DocId { get; init; }
    public required int PageIndex { get; init; }
    public required AnnotationKind Kind { get; init; }
    public required string Color { get; init; }
    public double StrokeWidth { get; init; } = 2.0;
    public double Opacity { get; init; } = 1.0;
    /// <summary>Stroke points (Ink/Highlighter/Arrow) or bounding box corners (others), in page points.</summary>
    public required List<PointD> Points { get; init; }
    public string Text { get; init; } = "";
    /// <summary>PNG bytes for Image annotations.</summary>
    public byte[]? ImageData { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}

public readonly record struct PointD(double X, double Y);

public sealed class Bookmark
{
    public required string Id { get; init; }
    public required string DocId { get; init; }
    public required int PageIndex { get; init; }
    public required string Label { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}

public sealed class NoteLink
{
    public required string DocId { get; init; }
    public required string DocName { get; init; }
    public required int PageIndex { get; init; }
}

public sealed class Note
{
    public required string Id { get; init; }
    public required string Title { get; set; }
    public required string Body { get; set; }
    public List<NoteLink> Links { get; set; } = new();
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class OutlineItem
{
    public required string Title { get; init; }
    public required int PageIndex { get; init; }
    public List<OutlineItem> Children { get; init; } = new();
}

public sealed class SearchResult
{
    public required string DocId { get; init; }
    public required string DocName { get; init; }
    public required int PageIndex { get; init; }
    public required string Snippet { get; init; }
}

public sealed class RecentFile
{
    public required string Path { get; init; }
    public required string Name { get; init; }
    public DateTime OpenedAt { get; init; } = DateTime.UtcNow;
}

/// <summary>Toast notification severity.</summary>
public enum ToastSeverity
{
    Info,
    Success,
    Warning,
    Error,
}
