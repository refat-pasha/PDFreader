using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using PDFreader.Core;

namespace PDFreader.App;

/// <summary>Rasterizes a PDF's pages to WPF bitmaps for the in-app print path.</summary>
public static class PdfPrintRenderer
{
    /// <summary>
    /// Renders every page at print resolution using the SHARED renderer.
    /// A separate PdfRenderer instance defeated the documented single-gate
    /// PDFium invariant (PDFium is not thread-safe across documents); the
    /// shared instance keeps print renders serialized with viewer renders.
    /// </summary>
    public static List<BitmapSource> RenderAllPages(string pdfPath, PdfRenderer? sharedRenderer = null)
    {
        var results = new List<BitmapSource>();
        using var owned = sharedRenderer is null ? new PdfRenderer() : null;
        var renderer = sharedRenderer ?? owned!;
        var count = new PdfService().GetPageCount(pdfPath);
        for (var page = 1; page <= count; page++)
        {
            var (w, h) = renderer.GetPageSize(pdfPath, null, page);
            // 150dpi = ~2.08x the 72dpi point size; clamp both axes so a tall
            // scanned page can't blow up memory (width-only clamp was unbounded).
            var widthPx = Math.Clamp((int)Math.Round(w * 2.08), 200, 2400);
            var heightPx = Math.Clamp((int)Math.Round(h * 2.08), 200, 3300);
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
