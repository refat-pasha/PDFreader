using System.IO;
using System.Windows;
using Microsoft.Win32;
using PDFreader.Core;
using PDFreader.Core.Models;

namespace PDFreader.App;

public partial class ExportDialog : Window
{
    private readonly DocumentInfo _doc;
    private readonly PdfService _pdf;
    private readonly Dictionary<string, string> _passwords;

    public ExportDialog(DocumentInfo doc, PdfService pdf, Dictionary<string, string> passwords)
    {
        InitializeComponent();
        _doc = doc;
        _pdf = pdf;
        _passwords = passwords;
        DocNameText.Text = doc.Name;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    private void Export_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var exported = new List<string>();
            if (ExportMarkdown.IsChecked == true) exported.Add(ExportMarkdownNotes());
            if (ExportText.IsChecked == true) exported.Add(ExportPageText());
            if (ExportDocx.IsChecked == true) exported.Add(ExportNotesDocx());
            if (ExportPng.IsChecked == true) exported.Add(ExportPagePng());
            StatusText.Text = exported.Count == 0
                ? "Select at least one format."
                : "Exported:\n" + string.Join("\n", exported);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Export failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private string ExportMarkdownNotes()
    {
        var dialog = new SaveFileDialog
        {
            Filter = "Markdown (*.md)|*.md",
            FileName = ExportService.NotesFilename(),
        };
        if (dialog.ShowDialog(this) != true) throw new OperationCanceledException();
        ExportService.WriteTextFile(dialog.FileName, ExportService.NotesToMarkdown(AppWorkspace.Notes));
        return dialog.FileName;
    }

    private string ExportPageText()
    {
        var dialog = new SaveFileDialog
        {
            Filter = "Text (*.txt)|*.txt",
            FileName = Path.GetFileNameWithoutExtension(_doc.Name) + "-text.txt",
        };
        if (dialog.ShowDialog(this) != true) throw new OperationCanceledException();
        var pages = new List<string>();
        _passwords.TryGetValue(_doc.Path, out var password);
        for (var page = 1; page <= _doc.PageCount; page++)
        {
            pages.Add($"--- Page {page} ---");
            pages.Add(_pdf.ExtractPageText(_doc.Path, password, page));
        }
        ExportService.WriteTextFile(dialog.FileName, string.Join(Environment.NewLine, pages));
        return dialog.FileName;
    }

    private string ExportNotesDocx()
    {
        var dialog = new SaveFileDialog
        {
            Filter = "Word document (*.docx)|*.docx",
            FileName = "pdfreader-notes.docx",
        };
        if (dialog.ShowDialog(this) != true) throw new OperationCanceledException();
        var paragraphs = new List<string>();
        foreach (var note in AppWorkspace.Notes)
        {
            paragraphs.Add(note.Title);
            paragraphs.Add(note.Body);
            paragraphs.Add("");
        }
        ExportService.WriteDocx(dialog.FileName, "PDFreader notes", paragraphs);
        return dialog.FileName;
    }

    private string ExportPagePng()
    {
        var viewer = (Owner as MainWindow)?.ActiveViewer;
        var dialog = new SaveFileDialog
        {
            Filter = "PNG image (*.png)|*.png",
            FileName = Path.GetFileNameWithoutExtension(_doc.Name) + $"-page{(viewer?.Page ?? 1)}.png",
        };
        if (dialog.ShowDialog(this) != true) throw new OperationCanceledException();
        using var renderer = new PdfRenderer();
        _passwords.TryGetValue(_doc.Path, out var password);
        var png = renderer.RenderPage(_doc.Path, password, viewer?.Page ?? 1, 1600);
        File.WriteAllBytes(dialog.FileName, png);
        return dialog.FileName;
    }

    private Workspace AppWorkspace => (Owner as MainWindow)!.Workspace;
}
