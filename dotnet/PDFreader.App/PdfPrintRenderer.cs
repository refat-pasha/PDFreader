using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using PDFreader.Core;

namespace PDFreader.App;

/// <summary>Rasterizes a PDF's pages to WPF bitmaps for the in-app print path.</summary>
public static class PdfPrintRenderer
{
    /// <summary>Renders every page at 150dpi (good print quality, bounded memory).</summary>
    public static List<BitmapSource> RenderAllPages(string pdfPath)
    {
        var results = new List<BitmapSource>();
        using var renderer = new PdfRenderer();
        var count = new PdfService().GetPageCount(pdfPath);
        for (var page = 1; page <= count; page++)
        {
            var (w, h) = renderer.GetPageSize(pdfPath, null, page);
            // 150dpi = ~2.08x the 72dpi point size; clamp so huge pages stay bounded.
            var widthPx = Math.Clamp((int)Math.Round(w * 2.08), 200, 2400);
            var png = renderer.RenderPage(pdfPath, null, page, widthPx);
            var image = new BitmapImage();
            using var stream = new MemoryStream(png);
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.StreamSource = stream;
            image.EndInit();
            image.Freeze();
            results.Add(image);
        }
        return results;
    }
}
