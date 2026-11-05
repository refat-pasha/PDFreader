using System.IO;
using PDFtoImage;
using PDFreader.Core;
using PDFreader.Core.Models;
using SkiaSharp;

namespace PDFreader.App;

/// <summary>
/// Builds a "flattened" annotated PDF: every page is rendered via PDFium and
/// the annotation marks are drawn directly into the raster before the page is
/// committed, so exported pages look exactly like the on-screen view.
/// </summary>
public static class PdfFlattenExporter
{
    public static void Export(
        PdfRenderer renderer,
        PdfService pdf,
        string sourcePath,
        string? password,
        int pageCount,
        string targetPath,
        IReadOnlyList<Annotation> annotations)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"pdfreader-export-{Guid.NewGuid():N}.pdf");
        try
        {
            using var document = SKDocument.CreatePdf(tempPath);
            for (var page = 1; page <= pageCount; page++)
            {
                // 2x scale for crisp output (144 dpi).
                var pageMarks = annotations.Where(a => a.PageIndex == page - 1).ToList();
                var (ptW, ptH) = GetPointSize(renderer, sourcePath, password, page);
                var outW = (int)Math.Round(ptW * 2);
                var outH = (int)Math.Round(ptH * 2);

                var png = renderer.RenderPage(sourcePath, password, page, outW);
                using var bitmap = SKBitmap.Decode(png);
                if (bitmap is null) continue;
                using var image = SKImage.FromBitmap(bitmap);
                using var canvas = document.BeginPage(image.Width, image.Height);
                canvas.DrawImage(image, 0, 0);
                if (pageMarks.Count > 0)
                    DrawMarks(canvas, pageMarks, image.Width / ptW, image.Height / ptH, ptW, ptH);
                document.EndPage();
            }
            document.Close();
        }
        finally
        {
            // Commit: move the completed file into place atomically.
            if (File.Exists(tempPath))
            {
                var targetDir = Path.GetDirectoryName(targetPath)!;
                Directory.CreateDirectory(targetDir);
                File.Move(tempPath, targetPath, overwrite: true);
            }
        }
    }

    private static (double W, double H) GetPointSize(PdfRenderer renderer, string path, string? password, int page)
    {
        // PDFium renders at 72dpi baseline; the unrotated page point size is the
        // bitmap size divided by the requested scale. We render once at width
        // 400 and infer point size from the aspect (PDF points are 72/inch).
        var (w, h) = renderer.GetPageSize(path, password, page);
        // GetPageSize returns rendered pixel size at scale 1.0 (72 dpi => 1px per pt).
        return (w, h);
    }

    private static void DrawMarks(SKCanvas canvas, IReadOnlyList<Annotation> marks, double pxW, double pxH, double ptW, double ptH)
    {
        // Marks are stored in page points (origin top-left). The raster is
        // top-left origin too, so mapping is a simple scale.
        double Sx = pxW / ptW;
        double Sy = pxH / ptH;

        SKPoint Map(PointD p) => new((float)(p.X * Sx), (float)(p.Y * Sy));

        foreach (var mark in marks)
        {
            using var paint = new SKPaint
            {
                Color = SKColor.Parse(mark.Color),
                StrokeWidth = (float)Math.Max(1, mark.StrokeWidth * Sx),
                IsAntialias = true,
                Style = SKPaintStyle.Stroke,
            };
            if (mark.Kind == AnnotationKind.Highlighter)
            {
                paint.StrokeWidth = (float)Math.Max(8, mark.StrokeWidth * 6 * Sx);
                paint.Color = paint.Color.WithAlpha((byte)(255 * mark.Opacity));
            }
            switch (mark.Kind)
            {
                case AnnotationKind.Ink or AnnotationKind.Highlighter:
                {
                    var path = new SKPath();
                    var points = mark.Points.Select(Map).ToList();
                    if (points.Count == 0) break;
                    path.MoveTo(points[0]);
                    foreach (var point in points.Skip(1))
                        path.LineTo(point);
                    canvas.DrawPath(path, paint);
                    break;
                }
                case AnnotationKind.Rectangle:
                {
                    var a = Map(mark.Points[0]);
                    var b = Map(mark.Points[^1]);
                    canvas.DrawRect(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Abs(b.X - a.X), Math.Abs(b.Y - a.Y), paint);
                    break;
                }
                case AnnotationKind.Ellipse:
                {
                    var a = Map(mark.Points[0]);
                    var b = Map(mark.Points[^1]);
                    canvas.DrawOval(new SKRect(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Max(a.X, b.X), Math.Max(a.Y, b.Y)), paint);
                    break;
                }
                case AnnotationKind.Arrow:
                {
                    var a = Map(mark.Points[0]);
                    var b = Map(mark.Points[^1]);
                    canvas.DrawLine(a, b, paint);
                    // Arrowhead
                    var angle = Math.Atan2(b.Y - a.Y, b.X - a.X);
                    var head = 12f;
                    canvas.DrawLine(b, new SKPoint(b.X - head * (float)Math.Cos(angle - Math.PI / 6), b.Y - head * (float)Math.Sin(angle - Math.PI / 6)), paint);
                    canvas.DrawLine(b, new SKPoint(b.X - head * (float)Math.Cos(angle + Math.PI / 6), b.Y - head * (float)Math.Sin(angle + Math.PI / 6)), paint);
                    break;
                }
            }
        }
    }
}
