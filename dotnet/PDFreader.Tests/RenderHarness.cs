// Isolates the render pipeline outside WPF: does PdfRenderer work at all on this host?
// Run via: dotnet exec PDFreader.Tests.dll --render-harness <pdf-path>
using PDFreader.Core;

public static class RenderHarness
{
    public static int Run(string[] args)
    {
        var fixture = args.Where(a => !a.StartsWith('-')).FirstOrDefault() ?? "native-sample.pdf";
        if (!Path.IsPathRooted(fixture)) fixture = Path.Combine(AppContext.BaseDirectory, "Fixtures", fixture);
        Console.WriteLine($"File: {fixture} exists={File.Exists(fixture)}");

        var renderer = new PdfRenderer();
        try
        {
            var (w, h) = renderer.GetPageSize(fixture, null, 1);
            Console.WriteLine($"PageSize: {w}x{h}");
            var png = renderer.RenderPage(fixture, null, 1, 400);
            Console.WriteLine($"Rendered: {png.Length} bytes, PNG magic: {png[0]:X2} {png[1]:X2} {png[2]:X2}");
            File.WriteAllBytes(@"D:\Codes\AI Agents\Deepseek Harness\PDFreader\dotnet\harness-render.png", png);
            Console.WriteLine("Saved harness-render.png");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"FAILED: {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine(ex.ToString());
            return 1;
        }
        return 0;
    }
}
