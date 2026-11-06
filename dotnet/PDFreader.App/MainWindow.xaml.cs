using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
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
    private readonly Dictionary<string, PageViewer> _viewersByDocId = new();
    private readonly Dictionary<string, Border> _tabsByDocId = new();
    private Note? _activeNote;
    private bool _suppressNoteEvents;
    private string _activeTool = "Select";

    public MainWindow()
    {
        InitializeComponent();
        _workspace.StateChanged += () => Dispatcher.Invoke(RefreshChrome);
        RestoreSession();
        UpdateRecentMenu();
        SetTool("Select");

        // Command-line PDFs (also the entry point for OS file association).
        Loaded += (_, _) =>
        {
            foreach (var arg in App.Arguments)
            {
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
            SelectDocument(doc);
            RememberRecent(path);
            SetStatus($"{doc.Name} — {doc.PageCount} pages");
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

    // ------------------------------------------------------------ tabs/viewer

    private void EnsureTab(DocumentInfo doc)
    {
        if (_viewersByDocId.ContainsKey(doc.Id)) return;

        var viewer = new PageViewer(doc, _renderer, _pdf, _passwords, _workspace);
        _viewersByDocId[doc.Id] = viewer;

        var tab = new Border
        {
            Background = Brushes.Transparent,
            CornerRadius = new CornerRadius(5),
            Margin = new Thickness(0, 0, 4, 4),
            Padding = new Thickness(10, 4, 6, 4),
            Cursor = Cursors.Hand,
            Tag = doc.Id,
            Child = BuildTabHeader(doc),
        };
        tab.MouseLeftButtonDown += (_, _) => SelectDocument(doc);
        _tabsByDocId[doc.Id] = tab;
        TabStrip.Children.Add(tab);
        EmptyState.Visibility = Visibility.Collapsed;

        viewer.Rendered += page =>
        {
            SetStatus($"{doc.Name} — page {page} rendered");
            UpdatePageChrome();
        };
    }

    private static StackPanel BuildTabHeader(DocumentInfo doc)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal };
        panel.Children.Add(new TextBlock
        {
            Text = doc.Name,
            MaxWidth = 150,
            TextTrimming = TextTrimming.CharacterEllipsis,
            FontSize = 12,
        });
        var close = new TextBlock
        {
            Text = "\uE711",
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 9,
            Margin = new Thickness(8, 1, 0, 0),
            Opacity = 0.7,
            Cursor = Cursors.Hand,
        };
        close.MouseLeftButtonDown += (_, args) =>
        {
            args.Handled = true;
            CloseDocument(doc.Id);
        };
        panel.Children.Add(close);
        return panel;
    }

    private static void CloseDocument(string docId)
    {
        if (Application.Current.MainWindow is MainWindow main)
            main.CloseTab(docId);
    }

    private void SelectDocument(DocumentInfo doc)
    {
        _workspace.SetActiveDocument(doc);
        if (ViewerHost.Content is PageViewer previous && previous != _viewersByDocId.GetValueOrDefault(doc.Id))
            ViewerHost.Content = null; // detached viewers stay alive with their documents
        ViewerHost.Content = _viewersByDocId.GetValueOrDefault(doc.Id);

        foreach (var pair in _tabsByDocId)
        {
            var active = pair.Key == doc.Id;
            pair.Value.Background = active ? new SolidColorBrush(Color.FromRgb(0x2A, 0x2D, 0x37)) : Brushes.Transparent;
            if (pair.Value.Child is StackPanel header && header.Children[0] is TextBlock label)
                label.Foreground = active
                    ? (Brush)FindResource("Brush.Text")
                    : (Brush)FindResource("Brush.TextMuted");
        }
        ShowPageForActiveDoc();
        RefreshBookmarks();
        RefreshThumbnails(doc);
        RefreshOutline(doc);
    }

    private void RefreshOutline(DocumentInfo doc)
    {
        if (OutlineTree.Items.Count > 0 && OutlineTree.Tag as string == doc.Id) return;
        _passwords.TryGetValue(doc.Path, out var pw);
        var outline = _pdf.GetOutline(doc.Path, pw);
        OutlineTree.ItemsSource = outline.Count > 0 ? outline : null;
        OutlineTree.Tag = doc.Id;
        if (outline.Count == 0) SetStatusSilent("This document has no outline.");
    }

    private void SetStatusSilent(string message)
    {
        // Outline hint only when nothing more important is showing.
        if (StatusText.Text.StartsWith("Ready") || StatusText.Text.Contains("rendered"))
            StatusText.Text = message;
    }

    private void CloseTab(string docId)
    {
        if (_viewersByDocId.TryGetValue(docId, out var viewer))
        {
            ViewerHost.Content = null;
            _viewersByDocId.Remove(docId);
        }
        if (_tabsByDocId.TryGetValue(docId, out var tab))
        {
            TabStrip.Children.Remove(tab);
            _tabsByDocId.Remove(docId);
        }
        var wasActive = _workspace.ActiveDocument?.Id == docId;
        _workspace.CloseDocument(docId);
        if (_workspace.Documents.Count > 0 && wasActive)
        {
            SelectDocument(_workspace.Documents[^1]);
        }
        else if (_workspace.Documents.Count == 0)
        {
            ViewerHost.Content = null;
            EmptyState.Visibility = Visibility.Visible;
            SetStatus("Ready. Open a PDF to begin.");
            PageCountText.Text = "–";
            MarkupText.Text = "";
            DocLabel.Text = "";
            Title = "PDFreader";
        }
        SaveSession();
    }

    // ------------------------------------------------------------ page render

    public PageViewer? ActiveViewer => _workspace.ActiveDocument is { } doc
        ? _viewersByDocId.GetValueOrDefault(doc.Id)
        : null;

    internal Workspace Workspace => _workspace;

    private void ShowPageForActiveDoc()
    {
        var viewer = ActiveViewer;
        if (viewer is null) return;
        viewer.ApplyZoomMode(_zoomMode, _zoom, ActualWidth, ActualHeight);
        UpdatePageChrome();
    }

    private void UpdatePageChrome()
    {
        var doc = _workspace.ActiveDocument;
        if (doc is null) return;
        PageBox.Text = (ActiveViewer?.Page ?? 1).ToString();
        PageCountText.Text = doc.PageCount.ToString();
        ZoomText.Text = $"{Math.Round(_zoom * 100)}%";
        var marks = _workspace.AnnotationCount(doc.Id);
        MarkupText.Text = marks == 0 ? "" : $"{marks} markup {(marks == 1 ? "item" : "items")}";
        PrevButton.IsEnabled = (ActiveViewer?.Page ?? 1) > 1;
        NextButton.IsEnabled = (ActiveViewer?.Page ?? 1) < doc.PageCount;
        DocLabel.Text = doc.Name;
        Title = $"{doc.Name} — PDFreader";
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
                SelectDocument(doc);
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
        ActiveViewer?.ApplyZoomMode(ZoomMode.Custom, _zoom, ActualWidth, ActualHeight);
        UpdatePageChrome();
    }

    private void OnFitPageClick(object sender, RoutedEventArgs e)
    {
        _zoomMode = ZoomMode.FitPage;
        ActiveViewer?.ApplyZoomMode(ZoomMode.FitPage, _zoom, ActualWidth, ActualHeight);
        UpdatePageChrome();
    }

    private void OnFitWidthClick(object sender, RoutedEventArgs e)
    {
        _zoomMode = ZoomMode.FitWidth;
        ActiveViewer?.ApplyZoomMode(ZoomMode.FitWidth, _zoom, ActualWidth, ActualHeight);
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
        _activeTool = tool;
        ActiveViewer?.SetTool(Enum.Parse<PageViewer.ToolMode>(tool, ignoreCase: true));
        foreach (var button in new[] { ToolSelect, ToolInk, ToolHighlighter, ToolRectangle, ToolEllipse, ToolArrow, ToolEraser })
        {
            button.Tag = string.Equals((string?)button.Tag, tool, StringComparison.OrdinalIgnoreCase) ? "active" : (string)button.Tag;
        }
        SetStatus($"Tool: {tool}");
    }

    private void OnSwatchClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string color }) return;
        ActiveViewer?.SetToolColor(color);
        SetStatus($"Color: {color}");
    }

    // --------------------------------------------------------------- sidebar

    private void ShowSidebarTab(string panel)
    {
        Rail.Visibility = Visibility.Visible;
        SidePanel.Visibility = Visibility.Visible;
        SidebarButton.Tag = "active";
        PanelPages.Visibility = panel == "pages" ? Visibility.Visible : Visibility.Collapsed;
        OutlineTree.Visibility = panel == "outline" ? Visibility.Visible : Visibility.Collapsed;
        PanelSearch.Visibility = panel == "search" ? Visibility.Visible : Visibility.Collapsed;
        PanelNotes.Visibility = panel == "notes" ? Visibility.Visible : Visibility.Collapsed;
        PanelBookmarks.Visibility = panel == "bookmarks" ? Visibility.Visible : Visibility.Collapsed;
        foreach (var button in new[] { RailPages, RailOutline, RailSearch, RailNotes, RailBookmarks })
        {
            var name = button.Tag as string ?? "";
            var isActive = name.Contains(panel);
            button.Tag = isActive ? name.Replace(panel, panel + " active") : name;
        }
    }

    private void OnRailClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string tag }) return;
        var panel = tag.Split(' ')[0];
        // Toggle closed when clicking the already-active rail button.
        if (SidePanel.Visibility == Visibility.Visible && (RailPages.Tag as string)?.Contains("active") == true && panel == "pages")
        {
            SidePanel.Visibility = Visibility.Collapsed;
            return;
        }
        ShowSidebarTab(panel);
        if (panel == "search") SearchBox.Focus();
    }

    private void OnSidebarClick(object sender, RoutedEventArgs e)
    {
        var show = SidePanel.Visibility == Visibility.Collapsed;
        SidePanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        SidebarButton.Tag = show ? "active" : "inactive";
    }

    private async void RefreshThumbnails(DocumentInfo doc)
    {
        PageCountBadge.Text = doc.PageCount.ToString();
        ThumbList.ItemsSource = null;
        if (doc.PageCount > 300) return;
        var items = Enumerable.Range(1, doc.PageCount)
            .Select(n => new ThumbnailItem { PageNumber = n })
            .ToList();
        ThumbList.ItemsSource = items;
        _thumbnailItems = items;
        _passwords.TryGetValue(doc.Path, out var password);
        foreach (var item in items)
        {
            if (_workspace.ActiveDocument?.Id != doc.Id) return; // user switched away
            try
            {
                await item.LoadAsync(_renderer, doc.Path, password);
                item.ReadingVisibility = item.PageNumber == (ActiveViewer?.Page ?? 1)
                    ? Visibility.Visible : Visibility.Collapsed;
                ThumbList.Items.Refresh();
            }
            catch { }
        }
    }

    private List<ThumbnailItem>? _thumbnailItems;

    private void UpdateReadingBadge()
    {
        if (_thumbnailItems is null) return;
        var current = ActiveViewer?.Page ?? 1;
        foreach (var item in _thumbnailItems)
            item.ReadingVisibility = item.PageNumber == current ? Visibility.Visible : Visibility.Collapsed;
        ThumbList.Items.Refresh();
    }

    private void OnNotesClick(object sender, RoutedEventArgs e) => ShowSidebarTab("notes");

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
        RefreshNoteList();
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
        ShowSidebarTab("Search");
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
        // Insert-image flow (renamed button in the app bar).
        var doc = _workspace.ActiveDocument;
        var viewer = ActiveViewer;
        if (doc is null || viewer is null) return;
        var dialog = new OpenFileDialog
        {
            Title = "Choose an image to stamp on the current page",
            Filter = "Images (*.png;*.jpg;*.jpeg)|*.png;*.jpg;*.jpeg",
        };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            viewer.InsertImageStamp(dialog.FileName);
            SetStatus($"Image stamped on page {viewer.Page}");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Insert image", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void OnInsertImageClick(object sender, RoutedEventArgs e) => OnOrganizeClick(sender, e);

    private void OnPrintClick(object sender, RoutedEventArgs e)
    {
        var doc = _workspace.ActiveDocument;
        var viewer = ActiveViewer;
        if (doc is null || viewer is null) return;
        try
        {
            var temp = Path.Combine(Path.GetTempPath(), $"pdfreader-print-{Guid.NewGuid():N}.pdf");
            viewer.ExportAnnotatedPdf(temp);
            var process = new System.Diagnostics.ProcessStartInfo(temp)
            {
                Verb = "print",
                UseShellExecute = true,
            };
            System.Diagnostics.Process.Start(process);
            SetStatus("Sent to the default PDF printer.");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Print", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void OnExitClick(object sender, RoutedEventArgs e) => Close();

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

    private void OnSaveClick(object sender, RoutedEventArgs e) => SaveAnnotatedCopy();

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
        // Recent files live in File menu via RecentMenu items (rebuilt here).
        var recent = _persistence.LoadRecent();
        _recentPaths = recent.Select(r => r.Path).ToList();
    }

    private List<string> _recentPaths = new();

    private void RememberRecent(string path)
    {
        var entries = _persistence.LoadRecent()
            .Where(r => !string.Equals(r.Path, path, StringComparison.OrdinalIgnoreCase))
            .ToList();
        entries.Insert(0, new RecentFile { Path = path, Name = Path.GetFileName(path) });
        _persistence.SaveRecent(entries);
        if (_persistence.StorageDegraded)
        {
            SetStatus("Settings storage is unavailable — recent files and session will not be saved.");
        }
        UpdateRecentMenu();
        RebuildFileMenu();
    }

    private void RebuildFileMenu()
    {
        // File menu items: Open, recents..., Save, Exit are rebuilt into _fileMenuHost.
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
                Page = _viewersByDocId.TryGetValue(doc.Id, out var v) ? v.Page : 1,
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
            var session = _persistence.LoadSession();
            if (session is null) return;
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
                    if (_viewersByDocId.TryGetValue(doc.Id, out var v))
                        v.RestoreState(view.Page, _zoom, _rotation, _zoomMode);
                }
            }
            if (session.ActivePath is { } active)
            {
                var doc = _workspace.Documents.FirstOrDefault(d => string.Equals(d.Path, active, StringComparison.OrdinalIgnoreCase));
                if (doc is not null) SelectDocument(doc);
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
        }
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
            case Key.P: OnPrintClick(sender, e); e.Handled = true; break;
            case Key.E when Keyboard.Modifiers.HasFlag(ModifierKeys.Shift):
                OnExportClick(sender, e); e.Handled = true; break;
            case Key.Left: OnPrevPageClick(sender, e); e.Handled = true; break;
            case Key.Right: OnNextPageClick(sender, e); e.Handled = true; break;
        }
    }

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
}
