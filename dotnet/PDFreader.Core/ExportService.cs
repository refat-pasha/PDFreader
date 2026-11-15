using System.IO;
using System.Text.Json;
using PDFreader.Core.Models;

namespace PDFreader.Core;

/// <summary>Export helpers: Markdown/TXT note export and simple DOCX (OpenXML) writing.</summary>
public static class ExportService
{
    public static string NotesToMarkdown(IReadOnlyList<Note> notes, DateTime? exportedAt = null)
    {
        var at = exportedAt ?? DateTime.Now;
        var lines = new List<string> { "# PDFreader notebook", "", $"*Exported {at:yyyy-MM-dd HH:mm}*", "" };
        if (notes.Count == 0)
        {
            lines.Add("_No notes._");
            return string.Join(Environment.NewLine, lines);
        }
        foreach (var note in notes)
        {
            lines.Add($"## {(string.IsNullOrWhiteSpace(note.Title) ? "Untitled note" : note.Title.Trim())}");
            lines.Add("");
            if (!string.IsNullOrWhiteSpace(note.Body))
            {
                // Escape Markdown-significant line starts so a note beginning
                // with '#' or '---' can't restructure the exported document.
                var body = note.Body.Trim();
                if (body.StartsWith("#") || body.StartsWith("---"))
                    lines.Add("\\" + body);
                else
                    lines.Add(body);
                lines.Add("");
            }
            if (note.Links.Count > 0)
            {
                lines.Add("**Linked pages**");
                lines.Add("");
                foreach (var link in note.Links)
                    lines.Add($"- {link.DocName}, page {link.PageIndex + 1}");
                lines.Add("");
            }
        }
        return string.Join(Environment.NewLine, lines);
    }

    public static void WriteTextFile(string path, string content) =>
        File.WriteAllText(path, content);

    /// <summary>
    /// Writes a minimal valid .docx containing the given plain-text paragraphs
    /// using OpenXML. Suitable for notes and extracted page text. Newlines
    /// inside a paragraph become explicit Break runs — Word collapses bare \n
    /// inside a single Text run.
    /// </summary>
    public static void WriteDocx(string path, string title, IReadOnlyList<string> paragraphs)
    {
        using var document = DocumentFormat.OpenXml.Packaging.WordprocessingDocument.Create(
            path, DocumentFormat.OpenXml.WordprocessingDocumentType.Document);
        var main = document.AddMainDocumentPart();
        var body = new DocumentFormat.OpenXml.Wordprocessing.Body();
        foreach (var paragraphText in paragraphs)
        {
            var paragraph = new DocumentFormat.OpenXml.Wordprocessing.Paragraph();
            var segments = (paragraphText ?? "").Split(["\r\n", "\n", "\r"], StringSplitOptions.None);
            for (var i = 0; i < segments.Length; i++)
            {
                if (i > 0) paragraph.AppendChild(new DocumentFormat.OpenXml.Wordprocessing.Break());
                paragraph.AppendChild(new DocumentFormat.OpenXml.Wordprocessing.Text(segments[i])
                {
                    Space = DocumentFormat.OpenXml.SpaceProcessingModeValues.Preserve,
                });
            }
            body.AppendChild(paragraph);
        }
        main.Document = new DocumentFormat.OpenXml.Wordprocessing.Document(body);
    }

    public static string NotesFilename(DateTime? at = null)
    {
        var date = (at ?? DateTime.Now).ToString("yyyy-MM-dd");
        return $"pdfreader-notes-{date}.md";
    }
}
