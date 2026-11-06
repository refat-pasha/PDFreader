using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using PDFreader.Core;
using PDFreader.Core.Models;

namespace PDFreader.App;

public partial class MainWindow : Window
{
    private readonly Workspace _workspace = new();
    private readonly PdfRenderer _renderer = new();
    private readonly PdfService _pdf = new();
    private readonly Persistence _persistence = new();

    /// <summary>Passwords kept in memory only, keyed by file path.</summary>
    private readonly Dictionary<string, string> _passwords = new(StringComparer.OrdinalIgnoreCase);

    private double _zoom = 1.0;
    private ZoomMode _zoomMode = ZoomMode.FitPage;
    private int _rotation;
    private readonly Dictionary<string, TabItem> _tabsByDocId = new();
    private Note? _activeNote;
    private bool _suppressNoteEvents;

    public MainWindow()
    {
        InitializeComponent();
        Diagnostics.Trace("MainWindow ctor begin");
        _docTabsLoaded = true;
        _workspace.StateChanged += () => Dispatcher.Invoke(RefreshChrome);
        RestoreSession();
        UpdateRecentMenu();
        Diagnostics.Trace("MainWindow ctor done");

        // Command-line PDFs (also the entry point for OS file association).
        Loaded += (_, _) =>
        {
            Diagnostics.Trace($"MainWindow Loaded, args={App.Arguments.Length}");
            foreach (var arg in App.Arguments)
            {
                Diagnostics.Trace($"arg: {arg} exists={File.Exists(arg)}");
                if (File.Exists(arg) && arg.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                    OpenPath(arg);
            }
        };
    }

    // ---------------------------------------------------------------- opening

    private void OnOpenClick(object sender, RoutedEventArgs e) => OpenWithDialog();

    private void OpenWithDialog()
    {
        var dialog = new OpenFileDialog
        {
            Title = "Open PDF",
            Filter = "PDF documents (*.pdf)|*.pdf",
            Multiselect = true,
        };
        if (dialog.ShowDialog(this) != true) return;
        foreach (var path in dialog.FileNames)
            OpenPath(path);
    }

    private void OpenPath(string path, string? password = null)
    {
        try
        {
            if (password is not null) _passwords[path] = password;
            _passwords.TryGetValue(path, out var stored);

            var count = _pdf.TryGetPageCount(path, out var needsPassword);
            if (needsPassword && stored is null)
            {
                AskPassword(path);
                return;
            }
            if (count is null && stored is not null)
            {
                try
                {
                    count = _pdf.GetPageCount(path, stored);
                }
                catch
                {
                    _passwords.Remove(path);
                    AskPassword(path, incorrect: true);
                    return;
                }
            }
            if (count is null)
            {
                SetStatus("That file could not be opened as a PDF.");
                return;
            }

            var doc = _workspace.OpenDocument(path, count.Value, requiresPassword: needsPassword);
            EnsureTab(doc);
            _workspace.SetActiveDocument(doc);
            RememberRecent(path);
            SetStatus($"{doc.Name} — {doc.PageCount} pages");
            ShowPageForActiveDoc();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "PDFreader", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void AskPassword(string path, bool incorrect = false)
    {
        var dialog = new PasswordDialog(path, incorrect) { Owner = this };
        if (dialog.ShowDialog() == true && !string.IsNullOrEmpty(dialog.PasswordValue))
            OpenPath(path, dialog.PasswordValue);
    }

    private void EnsureTab(DocumentInfo doc)
    {
        if (_tabsByDocId.ContainsKey(doc.Id)) return;
        Diagnostics.Trace($"EnsureTab {doc.Name}");

        var viewer = new PageViewer(doc, _renderer, _pdf, _passwords, _workspace);
        Diagnostics.Trace("EnsureTab viewer constructed");
        var tab = new TabItem
        {
            Header = BuildTabHeader(doc),
            Content = viewer,
            Tag = doc.Id,
        };
        DocTabs.Items.Add(tab);
        _tabsByDocId[doc.Id] = tab;
        EmptyState.Visibility = Visibility.Collapsed;
        // TabControl does not reliably auto-select items added at runtime;
        // without selection the content is never realized and the viewer
        // never gets a layout size.
        DocTabs.SelectedItem = tab;
        viewer.Rendered += page =>
        {
            SetStatus($"{doc.Name} — page {page} rendered");
            UpdatePageChrome();
        };
    }

    private static StackPanel BuildTabHeader(DocumentInfo doc)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal };
        panel.Children.Add(new TextBlock { Text = doc.Name, MaxWidth = 160, TextTrimming = TextTrimming.CharacterEllipsis });
        var close = new Button
        {
            Content = "✕",
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Margin = new Thickness(8, 0, 0, 0),
            Padding = new Thickness(2, 0, 2, 0),
            Cursor = Cursors.Hand,
        };
        close.Click += (_, args) =>
        {
            args.Handled = true;
            CloseDocument(doc.Id);
        };
        panel.Children.Add(close);
        return panel;
    }

    private static void CloseDocument(string docId)
    {
        // Handled through MainWindow via tag lookup in DocTabs_SelectionChanged owner.
        if (Application.Current.MainWindow is MainWindow main)
            main.CloseTab(docId);
    }

    private void CloseTab(string docId)
    {
        if (_tabsByDocId.TryGetValue(docId, out var tab))
        {
            DocTabs.Items.Remove(tab);
            _tabsByDocId.Remove(docId);
        }
        _workspace.CloseDocument(docId);
        if (_tabsByDocId.Count == 0)
        {
            EmptyState.Visibility = Visibility.Visible;
            SetStatus("Ready. Open a PDF to begin.");
            PageCountText.Text = "";
            MarkupText.Text = "";
        }
        SaveSession();
    }

    // ------------------------------------------------------------ page render

    public PageViewer? ActiveViewer => _docTabsLoaded
        ? (DocTabs.SelectedItem as TabItem)?.Content as PageViewer
        : null;

    private bool _docTabsLoaded;

    internal Workspace Workspace => _workspace;

    private void ShowPageForActiveDoc()
    {
        var viewer = ActiveViewer;
        if (viewer is null) return;
        viewer.ApplyZoomMode(_zoomMode, _zoom, ActualWidth);
        UpdatePageChrome();
    }

    private void UpdatePageChrome()
    {
        var doc = _workspace.ActiveDocument;
        if (doc is null) return;
        PageBox.Text = (ActiveViewer?.Page ?? 1).ToString();
        PageCountText.Text = $"of {doc.PageCount}";
        ZoomText.Text = $"{Math.Round(_zoom * 100)}%";
        var marks = _workspace.AnnotationCount(doc.Id);
        MarkupText.Text = marks == 0 ? "" : $"{marks} markup {(marks == 1 ? "item" : "items")}";
        PrevButton.IsEnabled = (ActiveViewer?.Page ?? 1) > 1;
        NextButton.IsEnabled = (ActiveViewer?.Page ?? 1) < doc.PageCount;
        Title = doc is null ? "PDFreader" : $"{doc.Name} — PDFreader";
    }

    private void RefreshChrome()
    {
        UpdatePageChrome();
        SaveButton.IsEnabled = _workspace.ActiveDocument is not null;
    }

    private void SetStatus(string message) => StatusText.Text = message;

    // ------------------------------------------------------------- navigation

    private void OnPrevPageClick(object sender, RoutedEventArgs e) => ActiveViewer?.GoToPage(ActiveViewer.Page - 1);
    private void OnNextPageClick(object sender, RoutedEventArgs e) => ActiveViewer?.GoToPage(ActiveViewer.Page + 1);

    private void PageBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        if (int.TryParse(PageBox.Text, out var page))
            ActiveViewer?.GoToPage(page);
        e.Handled = true;
    }

    private void ThumbList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ThumbList.SelectedItem is ThumbnailItem item && ActiveViewer is { } viewer)
            viewer.GoToPage(item.PageNumber);
    }

    private void OutlineTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is OutlineItem item && ActiveViewer is { } viewer)
            viewer.GoToPage(item.PageIndex + 1);
    }

    private void BookmarkList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (BookmarkList.SelectedItem is Bookmark bookmark && ActiveViewer is { } viewer)
            viewer.GoToPage(bookmark.PageIndex + 1);
    }

    private void SearchResults_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (SearchResults.SelectedItem is SearchResult hit)
        {
            if (_workspace.Documents.FirstOrDefault(d => d.Id == hit.DocId) is { } doc && doc.Id != _workspace.ActiveDocument?.Id)
            {
                _workspace.SetActiveDocument(doc);
                if (_tabsByDocId.TryGetValue(doc.Id, out var tab)) DocTabs.SelectedItem = tab;
            }
            ActiveViewer?.GoToPage(hit.PageIndex + 1);
        }
    }

    // ------------------------------------------------------------------- zoom

    private void OnZoomInClick(object sender, RoutedEventArgs e) => SetZoom(_zoom * 1.2);
    private void OnZoomOutClick(object sender, RoutedEventArgs e) => SetZoom(_zoom / 1.2);

    private void SetZoom(double zoom)
    {
        _zoom = Math.Clamp(zoom, 0.1, 6.0);
        _zoomMode = ZoomMode.Custom;
        ActiveViewer?.ApplyZoomMode(ZoomMode.Custom, _zoom, ActualWidth);
        UpdatePageChrome();
    }

    private void OnFitPageClick(object sender, RoutedEventArgs e)
    {
        _zoomMode = ZoomMode.FitPage;
        ActiveViewer?.ApplyZoomMode(ZoomMode.FitPage, _zoom, ActualWidth);
        UpdatePageChrome();
    }

    private void OnFitWidthClick(object sender, RoutedEventArgs e)
    {
        _zoomMode = ZoomMode.FitWidth;
        ActiveViewer?.ApplyZoomMode(ZoomMode.FitWidth, _zoom, ActualWidth);
        UpdatePageChrome();
    }

    private void OnRotateClick(object sender, RoutedEventArgs e)
    {
        _rotation = (_rotation + 90) % 360;
        ActiveViewer?.ApplyRotation(_rotation);
    }

    // ------------------------------------------------------------- markup tools

    private void OnToolClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string tool }) return;
        SetTool(tool);
    }

    private void SetTool(string tool)
    {
        ActiveViewer?.SetTool(Enum.Parse<PageViewer.ToolMode>(tool, ignoreCase: true));
        // Reflect active tool on the toolbar.
        foreach (var button in new[] { ToolSelect, ToolInk, ToolHighlighter, ToolRectangle, ToolEllipse, ToolArrow, ToolEraser })
        {
            button.FontWeight = string.Equals((string?)button.Tag, tool, StringComparison.OrdinalIgnoreCase)
                ? FontWeights.Bold
                : FontWeights.Normal;
            button.Background = string.Equals((string?)button.Tag, tool, StringComparison.OrdinalIgnoreCase)
                ? (Brush)FindResource("Brush.Accent")
                : (Brush)FindResource("Brush.SurfaceRaised");
        }
        SetStatus($"Tool: {tool}");
    }

    private void OnColorChanged(object sender, SelectionChangedEventArgs e)
    {
        // Fires during XAML init before any document is open.
        if (ActiveViewer is null) return;
        if (ColorPicker.SelectedItem is ComboBoxItem { Tag: string color })
            ActiveViewer.SetToolColor(color);
    }

    // ------------------------------------------------------------- edit tools

    private void OnUndoClick(object sender, RoutedEventArgs e)
    {
        var doc = _workspace.ActiveDocument;
        if (doc is not null && _workspace.Undo(doc.Id))
            ActiveViewer?.RedrawAnnotations();
    }

    private void OnRedoClick(object sender, RoutedEventArgs e)
    {
        var doc = _workspace.ActiveDocument;
        if (doc is not null && _workspace.Redo(doc.Id))
            ActiveViewer?.RedrawAnnotations();
    }

    // ------------------------------------------------------------------- save

    private void OnSaveClick(object sender, RoutedEventArgs e) => SaveAnnotatedCopy();

    private void SaveAnnotatedCopy()
    {
        var doc = _workspace.ActiveDocument;
        var viewer = ActiveViewer;
        if (doc is null || viewer is null) return;
        var dialog = new SaveFileDialog
        {
            Title = "Save annotated copy",
            Filter = "PDF documents (*.pdf)|*.pdf",
            FileName = Path.GetFileNameWithoutExtension(doc.Name) + "-annotated.pdf",
        };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            viewer.ExportAnnotatedPdf(dialog.FileName);
            SetStatus($"Saved annotated copy to {dialog.FileName}");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Export failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    // ------------------------------------------------------------------ notes

    private void OnNotesClick(object sender, RoutedEventArgs e)
    {
        Sidebar.Visibility = Visibility.Visible;
        SidebarTabs.SelectedItem = SidebarTabs.Items.OfType<TabItem>().First(t => t.Header.ToString() == "Notes");
    }

    private void OnNewNoteClick(object sender, RoutedEventArgs e)
    {
        _activeNote = _workspace.AddNote();
        RefreshNoteList();
        RefreshNoteEditor();
    }

    private void NoteList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _activeNote = NoteList.SelectedItem as Note;
        RefreshNoteEditor();
    }

    private void RefreshNoteList()
    {
        NoteList.ItemsSource = null;
        NoteList.ItemsSource = _workspace.Notes;
        NoteList.DisplayMemberPath = nameof(Note.Title);
    }

    private void RefreshNoteEditor()
    {
        _suppressNoteEvents = true;
        NoteTitle.Text = _activeNote?.Title ?? "";
        NoteBody.Text = _activeNote?.Body ?? "";
        _suppressNoteEvents = false;
    }

    private void NoteTitle_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressNoteEvents || _activeNote is null) return;
        _activeNote.Title = NoteTitle.Text;
        _workspace.TouchNote(_activeNote);
    }

    private void NoteBody_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressNoteEvents || _activeNote is null) return;
        _activeNote.Body = NoteBody.Text;
        _workspace.TouchNote(_activeNote);
    }

    // ----------------------------------------------------------------- search

    private void OnSearchClick(object sender, RoutedEventArgs e)
    {
        Sidebar.Visibility = Visibility.Visible;
        SidebarTabs.SelectedItem = SidebarTabs.Items.OfType<TabItem>().First(t => t.Header.ToString() == "Search");
        SearchBox.Focus();
    }

    private void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) RunSearch();
    }

    private void OnSearchSubmitClick(object sender, RoutedEventArgs e) => RunSearch();

    private async void RunSearch()
    {
        var query = SearchBox.Text.Trim();
        if (query.Length == 0) return;
        SearchResults.ItemsSource = null;
        SetStatus($"Searching for “{query}”…");
        var hits = await System.Threading.Tasks.Task.Run(() =>
        {
            var results = new List<SearchResult>();
            foreach (var doc in _workspace.Documents)
            {
                _passwords.TryGetValue(doc.Path, out var password);
                results.AddRange(_pdf.Search(doc.Path, doc.Id, doc.Name, password, query));
            }
            return results;
        });
        SearchResults.ItemsSource = hits;
        SetStatus(hits.Count == 0 ? $"No matches for “{query}”." : $"{hits.Count} matches for “{query}”.");
    }

    // -------------------------------------------------------------- bookmarks

    private void OnAddBookmarkClick(object sender, RoutedEventArgs e)
    {
        var doc = _workspace.ActiveDocument;
        var viewer = ActiveViewer;
        if (doc is null || viewer is null) return;
        var label = BookmarkBox.Text.Trim();
        _workspace.AddBookmark(doc.Id, viewer.Page - 1, label.Length == 0 ? null : label);
        BookmarkBox.Clear();
        RefreshBookmarks();
        SetStatus($"Bookmarked page {viewer.Page}");
    }

    private void RefreshBookmarks()
    {
        var doc = _workspace.ActiveDocument;
        BookmarkList.ItemsSource = doc is null ? null : _workspace.BookmarksFor(doc.Id);
        BookmarkList.DisplayMemberPath = nameof(Bookmark.Label);
    }

    // ---------------------------------------------------------------- exports

    private void OnExportClick(object sender, RoutedEventArgs e)
    {
        var doc = _workspace.ActiveDocument;
        if (doc is null) return;
        var dialog = new ExportDialog(doc, _pdf, _passwords) { Owner = this };
        dialog.ShowDialog();
    }

    private void OnOrganizeClick(object sender, RoutedEventArgs e)
    {
        var doc = _workspace.ActiveDocument;
        if (doc is null) return;
        MessageBox.Show(this,
            "Page organization (reorder/rotate/delete) is planned for the next build.",
            "Page organizer", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private void OnExitClick(object sender, RoutedEventArgs e) => Close();

    // ----------------------------------------------------------- drag & drop

    private void Window_DragOver(object sender, DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private void Window_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is not string[] files) return;
        foreach (var file in files.Where(f => f.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)))
            OpenPath(file);
    }

    // ------------------------------------------------------- recent + session

    private void UpdateRecentMenu()
    {
        RecentMenu.Items.Clear();
        var recent = _persistence.LoadRecent();
        foreach (var entry in recent)
        {
            var item = new MenuItem { Header = entry.Name, Tag = entry.Path };
            item.Click += (_, _) => OpenPath(entry.Path);
            RecentMenu.Items.Add(item);
        }
        if (recent.Count == 0)
        {
            RecentMenu.Items.Add(new MenuItem { Header = "(no recent files)", IsEnabled = false });
        }
    }

    private void RememberRecent(string path)
    {
        var entries = _persistence.LoadRecent()
            .Where(r => !string.Equals(r.Path, path, StringComparison.OrdinalIgnoreCase))
            .ToList();
        entries.Insert(0, new RecentFile { Path = path, Name = Path.GetFileName(path) });
        _persistence.SaveRecent(entries);
        if (_persistence.StorageDegraded)
        {
            // One clear warning instead of a crash per write.
            SetStatus("Settings storage is unavailable — recent files and session will not be saved.");
        }
        UpdateRecentMenu();
    }

    private void SaveSession()
    {
        var session = new Persistence.SessionFile
        {
            Paths = _workspace.Documents.Select(d => d.Path).ToList(),
            ActivePath = _workspace.ActiveDocument?.Path,
            Views = new Dictionary<string, Persistence.SessionView>(),
        };
        foreach (var doc in _workspace.Documents)
        {
            session.Views[doc.Path] = new Persistence.SessionView
            {
                Page = _tabsByDocId.TryGetValue(doc.Id, out var tab) && tab.Content is PageViewer v ? v.Page : 1,
                Zoom = _zoom,
                Rotation = _rotation,
            };
        }
        _persistence.SaveSession(session);
        _persistence.SaveAnnotations(_workspace.Annotations);
        _persistence.SaveNotes(_workspace.Notes);
        _persistence.SaveBookmarks(_workspace.Bookmarks);
    }

    private void RestoreSession()
    {
        try
        {
            Diagnostics.Trace("RestoreSession begin");
            var session = _persistence.LoadSession();
            if (session is null) { Diagnostics.Trace("RestoreSession: no session"); return; }
            foreach (var path in session.Paths.Take(8))
            {
                if (!File.Exists(path)) continue;
                var count = _pdf.TryGetPageCount(path, out var needsPassword);
                if (count is null) continue;
                var doc = _workspace.OpenDocument(path, count.Value, requiresPassword: needsPassword);
                EnsureTab(doc);
                if (session.Views.TryGetValue(path, out var view))
                {
                    _zoom = view.Zoom <= 0 ? 1.0 : view.Zoom;
                    _rotation = view.Rotation;
                    if (tabFor(path) is { } t && t.Content is PageViewer v)
                        v.RestoreState(view.Page, _zoom, _rotation, _zoomMode);
                }
            }
            if (session.ActivePath is { } active)
            {
                var doc = _workspace.Documents.FirstOrDefault(d => string.Equals(d.Path, active, StringComparison.OrdinalIgnoreCase));
                if (doc is not null && _tabsByDocId.TryGetValue(doc.Id, out var tab))
                {
                    DocTabs.SelectedItem = tab;
                    _workspace.SetActiveDocument(doc);
                }
            }
            foreach (var annotation in _persistence.LoadAnnotations())
                _workspace.ImportAnnotation(annotation);
            foreach (var note in _persistence.LoadNotes()) _workspace.Notes.Add(note);
            foreach (var bookmark in _persistence.LoadBookmarks()) _workspace.Bookmarks.Add(bookmark);
            RefreshNoteList();
            RefreshBookmarks();
            if (_workspace.Documents.Count > 0) EmptyState.Visibility = Visibility.Collapsed;
            UpdatePageChrome();
        }
        catch (Exception ex)
        {
            Diagnostics.Trace($"RestoreSession ERROR: {ex.GetType().Name}: {ex.Message}");
            // A damaged session should never block startup.
        }

        TabItem? tabFor(string path) =>
            _workspace.Documents.FirstOrDefault(d => string.Equals(d.Path, path, StringComparison.OrdinalIgnoreCase)) is { } d
            && _tabsByDocId.TryGetValue(d.Id, out var t) ? t : null;
    }

    protected override void OnClosed(EventArgs e)
    {
        SaveSession();
        _renderer.Dispose();
        base.OnClosed(e);
    }

    // -------------------------------------------------------------- shortcuts

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        var ctrl = Keyboard.Modifiers.HasFlag(ModifierKeys.Control);

        // Page turns without modifiers (when not typing in a field).
        if (!ctrl && e.Key is Key.PageDown or Key.PageUp or Key.Home or Key.End
            && Keyboard.FocusedElement is not TextBox)
        {
            if (ActiveViewer?.HandleKey(e.Key) == true)
            {
                e.Handled = true;
                return;
            }
        }

        if (!ctrl) return;
        switch (e.Key)
        {
            case Key.O: OpenWithDialog(); e.Handled = true; break;
            case Key.S: SaveAnnotatedCopy(); e.Handled = true; break;
            case Key.Z: OnUndoClick(sender, e); e.Handled = true; break;
            case Key.Y: OnRedoClick(sender, e); e.Handled = true; break;
            case Key.Add or Key.OemPlus: SetZoom(_zoom * 1.2); e.Handled = true; break;
            case Key.Subtract or Key.OemMinus: SetZoom(_zoom / 1.2); e.Handled = true; break;
            case Key.D1: OnFitWidthClick(sender, e); e.Handled = true; break;
            case Key.D2: OnFitPageClick(sender, e); e.Handled = true; break;
            case Key.R: OnRotateClick(sender, e); e.Handled = true; break;
            case Key.M: OnNotesClick(sender, e); e.Handled = true; break;
            case Key.F: OnSearchClick(sender, e); e.Handled = true; break;
            case Key.E when Keyboard.Modifiers.HasFlag(ModifierKeys.Shift):
                OnExportClick(sender, e); e.Handled = true; break;
            case Key.Left: OnPrevPageClick(sender, e); e.Handled = true; break;
            case Key.Right: OnNextPageClick(sender, e); e.Handled = true; break;
        }
    }

    private void DocTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (e.OriginalSource != DocTabs) return;
        if (DocTabs.SelectedItem is TabItem { Tag: string docId })
        {
            var doc = _workspace.Documents.FirstOrDefault(d => d.Id == docId);
            if (doc is not null)
            {
                _workspace.SetActiveDocument(doc);
                ShowPageForActiveDoc();
                RefreshBookmarks();
                RefreshThumbnails(doc);
                // Refresh outline lazily.
                if (OutlineTree.Items.Count == 0)
                {
                    _passwords.TryGetValue(doc.Path, out var pw);
                    var outline = _pdf.GetOutline(doc.Path, pw);
                    OutlineTree.ItemsSource = outline;
                }
            }
        }
    }

    private async void RefreshThumbnails(DocumentInfo doc)
    {
        ThumbList.ItemsSource = null;
        if (doc.PageCount > 200) return; // keep the sidebar cheap on huge documents
        var items = Enumerable.Range(1, doc.PageCount)
            .Select(n => new ThumbnailItem { PageNumber = n })
            .ToList();
        ThumbList.ItemsSource = items;
        _passwords.TryGetValue(doc.Path, out var password);
        foreach (var item in items)
        {
            try
            {
                await item.LoadAsync(_renderer, doc.Path, password);
                ThumbList.Items.Refresh();
            }
            catch
            {
                // A failed thumbnail shows as blank rather than breaking the list.
            }
        }
    }
}
