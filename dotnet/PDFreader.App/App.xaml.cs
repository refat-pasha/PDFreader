using System.IO;
using System.Windows;

namespace PDFreader.App;

public partial class App : Application
{
    public static string[] Arguments { get; private set; } = Array.Empty<string>();

    protected override void OnStartup(StartupEventArgs e)
    {
        // Route unhandled exceptions to a log the user can find.
        DispatcherUnhandledException += (_, args) =>
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(AppContext.BaseDirectory, "unhandled.log"),
                    $"{DateTime.Now:HH:mm:ss} {args.Exception}{Environment.NewLine}");
            }
            catch { }
            MessageBox.Show(args.Exception.Message, "PDFreader error");
            args.Handled = true;
        };
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(AppContext.BaseDirectory, "unhandled.log"),
                    $"{DateTime.Now:HH:mm:ss} FATAL {args.ExceptionObject}{Environment.NewLine}");
            }
            catch { }
        };

        Arguments = e.Args;
        // --smoke-render <file>: layout smoke test, bypasses the main window.
        if (Arguments.FirstOrDefault() == "--smoke-render")
        {
            var fixture = Arguments.Length > 1 ? Arguments[1] : "";
            var smoke = new SmokeWindow(fixture);
            smoke.Show();
            smoke.Closed += (_, _) => Shutdown();
            return;
        }
        base.OnStartup(e);
    }
}
