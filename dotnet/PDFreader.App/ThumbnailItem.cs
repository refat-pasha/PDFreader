using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using PDFreader.Core;

namespace PDFreader.App;

/// <summary>Lazy thumbnail item for the sidebar page list.</summary>
public sealed class ThumbnailItem
{
    public required int PageNumber { get; init; }
    public BitmapImage? Image { get; private set; }
    public bool Loaded { get; private set; }

    /// <summary>Shown for the page currently open in the viewer.</summary>
    public Visibility ReadingVisibility { get; set; } = Visibility.Collapsed;

    public async Task LoadAsync(PdfRenderer renderer, string path, string? password)
    {
        if (Loaded) return;
        Loaded = true;
        var png = await Task.Run(() => renderer.RenderPage(path, password, PageNumber, 150));
        var image = new BitmapImage();
        using var stream = new MemoryStream(png);
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.StreamSource = stream;
        image.EndInit();
        image.Freeze();
        Image = image;
    }
}
