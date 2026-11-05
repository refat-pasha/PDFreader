using System.IO;

namespace PDFreader.App;

/// <summary>Developer diagnostics: append-only trace to %TEMP% for verifying render flow.</summary>
public static class Diagnostics
{
    private static readonly string Path =
        System.IO.Path.Combine(System.IO.Path.GetTempPath(), "pdfreader-wpf-trace.log");

    public static void Trace(string message)
    {
        var line = $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}";
        foreach (var candidate in new[]
                 {
                     System.IO.Path.Combine(System.IO.Path.GetTempPath(), "pdfreader-wpf-trace.log"),
                     System.IO.Path.Combine(AppContext.BaseDirectory, "trace.log"),
                 })
        {
            try
            {
                File.AppendAllText(candidate, line);
            }
            catch
            {
            }
        }
    }
}
