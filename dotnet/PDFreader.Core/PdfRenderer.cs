using PDFtoImage;
using SkiaSharp;

namespace PDFreader.Core;

/// <summary>
/// PDFium rendering through PDFtoImage. Keeps a small bounded byte cache of
/// recently used PDFs so page turns do not re-read the file, and a page-size
/// cache so measurements never trigger a hidden render. All calls serialize
/// on one gate (PDFium is not thread-safe across documents).
/// </summary>
public sealed class PdfRenderer : IDisposable
{
    private sealed class CacheEntry
    {
        public required byte[] Bytes { get; init; }
        public DateTime LastUsed { get; set; }
        /// <summary>Page points (at 72dpi, rotation 0) per page index — the true page box.</summary>
        public readonly Dictionary<int, (double W, double H)> PageSizes = new();
    }

    private readonly Dictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);
    private const int MaxCached = 4;
    private readonly object _gate = new();

    public byte[] RenderPage(string path, string? password, int pageNumber, int widthPixels, int rotationDegrees = 0)
    {
        if (pageNumber < 1) throw new ArgumentOutOfRangeException(nameof(pageNumber));
        if (widthPixels < 16 || widthPixels > 8000) throw new ArgumentOutOfRangeException(nameof(widthPixels));

        lock (_gate)
        {
            var entry = GetOrLoad(path);
            // Single render pass: derive output height from the cached point
            // aspect instead of rendering a second time to measure.
            var (ptW, ptH) = GetPageSizeUnsafe(entry, password, pageNumber);
            var scale = widthPixels / (double)ptW;
            var outW = (int)Math.Round(ptW * scale);
            var outH = (int)Math.Round(ptH * scale);
            // Rotation swaps the output box (PDFtoImage rotates after layout).
            if (rotationDegrees is 90 or 270) (outW, outH) = (outH, outW);
            var options = BuildOptions(password, rotationDegrees, outW, outH);
            using var bitmap = Conversion.ToImage(entry.Bytes, pageNumber - 1, password, options);
            using var image = SKImage.FromBitmap(bitmap);
            using var data = image.Encode(SKEncodedImageFormat.Png, 90);
            return data.ToArray();
        }
    }

    public (int Width, int Height) GetPageSize(string path, string? password, int pageNumber)
    {
        lock (_gate)
        {
            var entry = GetOrLoad(path);
            var (w, h) = GetPageSizeUnsafe(entry, password, pageNumber);
            return ((int)Math.Round(w), (int)Math.Round(h));
        }
    }

    /// <summary>
    /// Page box in points at rotation 0, measured once per page and cached.
    /// Measurement renders the page once at 72dpi; subsequent calls are free.
    /// </summary>
    private static (double W, double H) GetPageSizeUnsafe(CacheEntry entry, string? password, int pageNumber)
    {
        if (entry.PageSizes.TryGetValue(pageNumber, out var cached))
            return cached;
        using var bitmap = Conversion.ToImage(entry.Bytes, pageNumber - 1, password, BuildOptions(password, 0, null, null));
        var size = ((double)bitmap.Width, (double)bitmap.Height);
        entry.PageSizes[pageNumber] = size;
        return size;
    }

    private static RenderOptions BuildOptions(string? password, int rotationDegrees, int? width, int? height) =>
        new(
            Dpi: 72,
            Width: width,
            Height: height,
            WithAnnotations: true,
            WithFormFill: true,
            WithAspectRatio: false,
            Rotation: rotationDegrees switch
            {
                90 => PdfRotation.Rotate90,
                180 => PdfRotation.Rotate180,
                270 => PdfRotation.Rotate270,
                _ => PdfRotation.Rotate0,
            },
            AntiAliasing: PdfAntiAliasing.All,
            BackgroundColor: null,
            Bounds: null,
            UseTiling: false,
            DpiRelativeToBounds: false);

    private CacheEntry GetOrLoad(string path)
    {
        if (_cache.TryGetValue(path, out var entry))
        {
            entry.LastUsed = DateTime.UtcNow;
            return entry;
        }
        entry = new CacheEntry { Bytes = File.ReadAllBytes(path), LastUsed = DateTime.UtcNow };
        _cache[path] = entry;
        while (_cache.Count > MaxCached)
        {
            var oldest = _cache.OrderBy(kv => kv.Value.LastUsed).First();
            _cache.Remove(oldest.Key);
        }
        return entry;
    }

    public void Dispose() => _cache.Clear();
}
