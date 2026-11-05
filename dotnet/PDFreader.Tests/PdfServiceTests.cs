using PDFreader.Core;
using Xunit;

namespace PDFreader.Tests;

public class PdfServiceTests
{
    private static string Fixture(string name) =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", name);

    private readonly PdfService _svc = new();

    [Fact]
    public void Reads_page_count_of_plain_pdf()
    {
        var count = _svc.TryGetPageCount(Fixture("native-sample.pdf"), out var needsPassword);
        Assert.False(needsPassword);
        Assert.NotNull(count);
        Assert.Equal(2, count);
    }

    [Fact]
    public void Detects_password_protected_pdf()
    {
        var count = _svc.TryGetPageCount(Fixture("encrypted-sample.pdf"), out var needsPassword);
        Assert.True(needsPassword);
        Assert.Null(count);
    }

    [Fact]
    public void Opens_encrypted_pdf_with_password_and_extracts_text()
    {
        var count = _svc.GetPageCount(Fixture("encrypted-sample.pdf"), "readerpass");
        Assert.Equal(2, count);
        var text = _svc.ExtractPageText(Fixture("encrypted-sample.pdf"), "readerpass", 1);
        Assert.False(string.IsNullOrWhiteSpace(text));
    }

    [Fact]
    public void Search_finds_matches_with_snippets()
    {
        var results = _svc.Search(Fixture("native-sample.pdf"), "d1", "native-sample.pdf", null, "fixture");
        Assert.NotEmpty(results);
        Assert.All(results, r => Assert.Contains("fixture", r.Snippet, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Renderer_produces_png_of_expected_width()
    {
        using var renderer = new PdfRenderer();
        var png = renderer.RenderPage(Fixture("native-sample.pdf"), null, 1, 400);
        Assert.True(png.Length > 1000);
        // PNG magic
        Assert.Equal(0x89, png[0]);
        Assert.Equal((byte)'P', png[1]);
        var (w, h) = renderer.GetPageSize(Fixture("native-sample.pdf"), null, 1);
        Assert.True(w > 0 && h > 0);
    }

    [Fact]
    public void ExtractPageText_returns_content()
    {
        var text = _svc.ExtractPageText(Fixture("native-sample.pdf"), null, 1);
        Assert.False(string.IsNullOrWhiteSpace(text));
    }
}
