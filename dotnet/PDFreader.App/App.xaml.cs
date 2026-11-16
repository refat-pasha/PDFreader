using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Windows;

namespace PDFreader.App;

public partial class App : Application
{
    public static string[] Arguments { get; private set; } = Array.Empty<string>();

    private const string MutexName = "PDFreader-SingleInstance-{C9F3F2A1-4E8E-4D5B-B1A0-7E6C2D8F5B31}";
    private const string PipeName = "PDFreader-ArgsPipe-{C9F3F2A1-4E8E-4D5B-B1A0-7E6C2D8F5B31}";
    private static Mutex? _singleInstanceMutex;

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

        // --smoke-render <file>: layout smoke test, bypasses the main window
        // (and the single-instance machinery).
        if (Arguments.FirstOrDefault() == "--smoke-render")
        {
            var fixture = Arguments.Length > 1 ? Arguments[1] : "";
            var smoke = new SmokeWindow(fixture);
            smoke.Show();
            smoke.Closed += (_, _) => Shutdown();
            return;
        }

        // Single instance: double-clicking a second PDF while PDFreader is
        // running must open it as a TAB in the existing window, not spawn a
        // second window. First launch owns the mutex and listens on a named
        // pipe; later launches forward their file arguments and exit.
        _singleInstanceMutex = new Mutex(initiallyOwned: true, MutexName, out var isNew);
        if (!isNew)
        {
            ForwardArgumentsToRunningInstance(Arguments);
            Shutdown(0);
            return;
        }

        StartArgumentsPipeListener();
        base.OnStartup(e);
    }

    private static void ForwardArgumentsToRunningInstance(string[] args)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            // The owning instance may be mid-startup; retry briefly.
            var deadline = DateTime.UtcNow.AddSeconds(3);
            while (true)
            {
                try { pipe.Connect(500); break; }
                catch (TimeoutException) when (DateTime.UtcNow < deadline) { }
            }
            var payload = string.Join("\n", args);
            var bytes = Encoding.UTF8.GetBytes(payload);
            pipe.Write(bytes, 0, bytes.Length);
            pipe.Flush();
        }
        catch
        {
            // Forwarding is best-effort; the second instance just exits.
        }
    }

    private void StartArgumentsPipeListener()
    {
        Task.Run(async () =>
        {
            while (true)
            {
                try
                {
                    using var server = new NamedPipeServerStream(PipeName, PipeDirection.In);
                    await server.WaitForConnectionAsync();
                    using var reader = new StreamReader(server, Encoding.UTF8);
                    var payload = await reader.ReadToEndAsync();
                    if (string.IsNullOrWhiteSpace(payload)) continue;
                    var files = payload.Split('\n', StringSplitOptions.RemoveEmptyEntries)
                        .Where(a => File.Exists(a) && a.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                        .ToArray();
                    if (files.Length == 0) continue;
                    Dispatcher.Invoke(() =>
                    {
                        if (MainWindow is MainWindow main)
                        {
                            foreach (var file in files) main.OpenPath(file);
                            main.Activate();
                        }
                    });
                }
                catch
                {
                    // A broken pipe (client gone) must not kill the listener.
                }
            }
        });
    }
}
