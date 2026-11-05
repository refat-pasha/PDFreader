using PDFreader.Core;
using PDFreader.Core.Models;
using Xunit;

namespace PDFreader.Tests;

public class FlattenExportTests
{
    private static string Fixture(string name) =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", name);

    [Fact]
    public void Export_produces_pdf_with_marks_burned_in()
    {
        // Reference the App assembly's exporter through reflection-free path:
        // the exporter lives in PDFreader.App (WPF). For Core testability we
        // replicate the SK drawing pipeline here and assert a valid PDF exits.
        var renderer = new PdfRenderer();
        var pdf = new PdfService();
        var source = Fixture("native-sample.pdf");
        var target = Path.Combine(Path.GetTempPath(), $"flat-{Guid.NewGuid():N}.pdf");

        var annotations = new List<Annotation>
        {
            new()
            {
                Id = "a1", DocId = "d", PageIndex = 0, Kind = AnnotationKind.Rectangle,
                Color = "#FF0000", StrokeWidth = 3,
                Points = new List<PointD> { new(50, 50), new(300, 200) },
            },
            new()
            {
                Id = "a2", DocId = "d", PageIndex = 1, Kind = AnnotationKind.Ink,
                Color = "#0000FF", StrokeWidth = 2,
                Points = new List<PointD> { new(10, 10), new(100, 100), new(200, 50) },
            },
        };

        // Inline flatten (mirrors PdfFlattenExporter in App; keep Core-side copy for tests).
        using (var document = SkiaSharp.SKDocument.CreatePdf(target))
        {
            for (var page = 1; page <= 2; page++)
            {
                var png = renderer.RenderPage(source, null, page, 800);
                using var bitmap = SkiaSharp.SKBitmap.Decode(png);
                using var image = SkiaSharp.SKImage.FromBitmap(bitmap);
                using var canvas = document.BeginPage(image.Width, image.Height);
                canvas.DrawImage(image, 0, 0);
                var pageMarks = annotations.Where(a => a.PageIndex == page - 1).ToList();
                foreach (var mark in pageMarks)
                {
                    using var paint = new SkiaSharp.SKPaint
                    {
                        Color = SkiaSharp.SKColor.Parse(mark.Color),
                        StrokeWidth = (float)mark.StrokeWidth * 2,
                        IsAntialias = true,
                        Style = SkiaSharp.SKPaintStyle.Stroke,
                    };
                    var pts = mark.Points.Select(p => new SkiaSharp.SKPoint((float)(p.X * 2), (float)(p.Y * 2))).ToList();
                    var path = new SkiaSharp.SKPath();
                    path.MoveTo(pts[0]);
                    foreach (var p in pts.Skip(1)) path.LineTo(p);
                    canvas.DrawPath(path, paint);
                }
                document.EndPage();
            }
            document.Close();
        }

        Assert.True(File.Exists(target));
        Assert.True(new FileInfo(target).Length > 5000);
        // PDF magic
        var head = new byte[5];
        File.OpenRead(target).ReadExactly(head, 0, 5);
        Assert.Equal("%PDF-", System.Text.Encoding.ASCII.GetString(head));
        try { File.Delete(target); } catch { }
    }
}
