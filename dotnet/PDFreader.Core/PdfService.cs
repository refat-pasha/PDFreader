using PDFreader.Core.Models;

namespace PDFreader.Core;

/// <summary>
/// PDF access layer. Text, outline and password handling use PdfPig; page
/// rendering is provided by <see cref="PdfRenderer"/> (PDFium via PDFtoImage).
/// </summary>
public sealed class PdfService
{

    /// <summary>Number of pages, throwing for corrupt files. Returns null when a password is required.</summary>
    public int? TryGetPageCount(string path, out bool needsPassword)
    {
        needsPassword = false;
        try
        {
            using var doc = UglyToad.PdfPig.PdfDocument.Open(path, new UglyToad.PdfPig.ParsingOptions { Password = null });
            return doc.NumberOfPages;
        }
        catch (UglyToad.PdfPig.Exceptions.PdfDocumentEncryptedException)
        {
            needsPassword = true;
            return null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    public int GetPageCount(string path, string? password = null)
    {
        using var doc = OpenPig(path, password);
        return doc.NumberOfPages;
    }

    /// <summary>Extracts the full text of a page with lines joined by spaces.</summary>
    public string ExtractPageText(string path, string? password, int pageNumber)
    {
        using var doc = OpenPig(path, password);
        if (pageNumber < 1 || pageNumber > doc.NumberOfPages) return "";
        var page = doc.GetPage(pageNumber);
        return string.Join(" ", page.GetWords().Select(w => w.Text));
    }

    public List<SearchResult> Search(string path, string docId, string docName, string? password, string query, int maxResults = 300)
    {
        var results = new List<SearchResult>();
        if (string.IsNullOrWhiteSpace(query)) return results;
        using var doc = OpenPig(path, password);
        var needle = query.Trim();
        foreach (var page in doc.GetPages())
        {
            var words = page.GetWords().Select(w => w.Text).ToList();
            var text = string.Join(" ", words);
            int index = text.IndexOf(needle, StringComparison.OrdinalIgnoreCase);
            while (index >= 0 && results.Count < maxResults)
            {
                int start = Math.Max(0, index - 40);
                int end = Math.Min(text.Length, index + needle.Length + 40);
                results.Add(new SearchResult
                {
                    DocId = docId,
                    DocName = docName,
                    PageIndex = page.Number - 1,
                    Snippet = text[start..end].Replace("\n", " ").Trim(),
                });
                index = text.IndexOf(needle, index + needle.Length, StringComparison.OrdinalIgnoreCase);
            }
            if (results.Count >= maxResults) break;
        }
        return results;
    }

    /// <summary>Extracts the document outline (bookmarks), flattening destinations to page indexes.</summary>
    public List<OutlineItem> GetOutline(string path, string? password)
    {
        var roots = new List<OutlineItem>();
        try
        {
            using var doc = OpenPig(path, password);
            if (!doc.TryGetBookmarks(out var bookmarks) || bookmarks.Roots.Count == 0)
                return roots;
            void MapChildren(UglyToad.PdfPig.Outline.BookmarkNode node, List<OutlineItem> into)
            {
                foreach (var child in node.Children)
                {
                    int pageIndex = child is UglyToad.PdfPig.Outline.DocumentBookmarkNode documentChild
                        ? Math.Max(0, documentChild.PageNumber - 1)
                        : 0;
                    var item = new OutlineItem { Title = child.Title ?? "(untitled)", PageIndex = pageIndex };
                    MapChildren(child, item.Children);
                    into.Add(item);
                }
            }
            foreach (var root in bookmarks.Roots)
            {
                int pageIndex = root is UglyToad.PdfPig.Outline.DocumentBookmarkNode documentRoot
                    ? Math.Max(0, documentRoot.PageNumber - 1)
                    : 0;
                var item = new OutlineItem { Title = root.Title ?? "(untitled)", PageIndex = pageIndex };
                MapChildren(root, item.Children);
                roots.Add(item);
            }
        }
        catch
        {
            // Outline is optional; a damaged or missing outline yields an empty list.
        }
        return roots;
    }

    private static UglyToad.PdfPig.PdfDocument OpenPig(string path, string? password)
    {
        if (string.IsNullOrEmpty(password))
            return UglyToad.PdfPig.PdfDocument.Open(path);
        return UglyToad.PdfPig.PdfDocument.Open(path, new UglyToad.PdfPig.ParsingOptions { Password = password });
    }
}
