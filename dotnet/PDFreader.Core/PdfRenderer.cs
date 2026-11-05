using PDFtoImage;
using SkiaSharp;

namespace PDFreader.Core;

/// <summary>
/// PDFium rendering through PDFtoImage. Keeps a small bounded byte cache of
/// recently used PDFs so page turns and thumbnails do not re-read the file for
/// every request. The underlying PDFium engine is not thread-safe across
/// documents, so all calls serialize on one gate.
/// </summary>
public sealed class PdfRenderer : IDisposable
{
    private sealed class CacheEntry
    {
        public required byte[] Bytes { get; init; }
        public DateTime LastUsed { get; set; }
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
            var bytes = GetOrLoad(path);
            var pageSize = GetPageSizeUnsafe(bytes, password, pageNumber);
            var scale = widthPixels / (double)pageSize.Width;
            var options = BuildOptions(password, rotationDegrees, (int)Math.Round(pageSize.Width * scale), (int)Math.Round(pageSize.Height * scale));
            using var bitmap = Conversion.ToImage(bytes, pageNumber - 1, password, options);
            using var image = SKImage.FromBitmap(bitmap);
            using var data = image.Encode(SKEncodedImageFormat.Png, 90);
            return data.ToArray();
        }
    }

    public (int Width, int Height) GetPageSize(string path, string? password, int pageNumber)
    {
        lock (_gate)
        {
            var bytes = GetOrLoad(path);
            return GetPageSizeUnsafe(bytes, password, pageNumber);
        }
    }

    private static (int Width, int Height) GetPageSizeUnsafe(byte[] bytes, string? password, int pageNumber)
    {
        using var bitmap = Conversion.ToImage(bytes, pageNumber - 1, password, BuildOptions(password, 0, null, null));
        return (bitmap.Width, bitmap.Height);
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

    private byte[] GetOrLoad(string path)
    {
        if (_cache.TryGetValue(path, out var entry))
        {
            entry.LastUsed = DateTime.UtcNow;
            return entry.Bytes;
        }
        var bytes = File.ReadAllBytes(path);
        _cache[path] = new CacheEntry { Bytes = bytes, LastUsed = DateTime.UtcNow };
        while (_cache.Count > MaxCached)
        {
            var oldest = _cache.OrderBy(kv => kv.Value.LastUsed).First();
            _cache.Remove(oldest.Key);
        }
        return bytes;
    }

    public void Dispose() => _cache.Clear();
}
