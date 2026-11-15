using System.ComponentModel;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Media.Imaging;
using PDFreader.Core;

namespace PDFreader.App;

/// <summary>Lazy thumbnail item for the sidebar page list.</summary>
/// <remarks>
/// Implements INotifyPropertyChanged: the old design required a full
/// ThumbList.Items.Refresh() after every single thumbnail loaded — 300
/// thumbnails = 300 complete list re-layouts on the UI thread while a large
/// PDF opened (the main source of the "large PDF = laggy UI" report).
/// </remarks>
public sealed class ThumbnailItem : INotifyPropertyChanged
{
    private BitmapImage? _image;
    private bool _loaded;
    private Visibility _readingVisibility = Visibility.Collapsed;
    private string _status = "Queued";

    public required int PageNumber { get; init; }

    public BitmapImage? Image
    {
        get => _image;
        private set { _image = value; OnPropertyChanged(); }
    }

    /// <summary>True once rendered successfully (failed renders retry).</summary>
    public bool Loaded
    {
        get => _loaded;
        private set { _loaded = value; OnPropertyChanged(); }
    }

    /// <summary>Shown for the page currently open in the viewer.</summary>
    public Visibility ReadingVisibility
    {
        get => _readingVisibility;
        set { _readingVisibility = value; OnPropertyChanged(); }
    }

    /// <summary>Queue state shown as a subtle placeholder while rendering.</summary>
    public string Status
    {
        get => _status;
        private set { _status = value; OnPropertyChanged(); }
    }

    /// <summary>Renders this thumbnail. Visible-first scheduling lives in MainWindow.</summary>
    public async Task LoadAsync(PdfRenderer renderer, string path, string? password)
    {
        if (Loaded) return;
        Status = "…";
        try
        {
            var png = await Task.Run(() => renderer.RenderPage(path, password, PageNumber, 150));
            var image = new BitmapImage();
            using var stream = new MemoryStream(png);
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.StreamSource = stream;
            image.EndInit();
            image.Freeze();
            Image = image;
            Status = "";
            Loaded = true;
        }
        catch
        {
            // Mark-as-loaded-before-render left failed thumbnails permanently
            // blank for the session; allow a retry on the next refresh.
            Status = "";
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
