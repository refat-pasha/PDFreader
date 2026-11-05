using System.IO;
using System.Windows;
using PDFreader.Core;

namespace PDFreader.App;

/// <summary>
/// Layout smoke test: hosts PageViewer directly in a window (no TabControl)
/// and writes the resulting layout numbers to the trace. Launched with
/// --smoke-render. Exits automatically.
/// </summary>
public partial class SmokeWindow : Window
{
    public SmokeWindow(string fixture)
    {
        InitializeComponent();
        Diagnostics.Trace("Smoke: ctor begin");
        var workspace = new Workspace();
        var renderer = new PdfRenderer();
        var pdf = new PdfService();
        var doc = workspace.OpenDocument(fixture, pdf.GetPageCount(fixture));
        var viewer = new PageViewer(doc, renderer, pdf, new Dictionary<string, string>(), workspace);
        Host.Children.Add(viewer);
        Diagnostics.Trace("Smoke: viewer added");

        var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        int ticks = 0;
        timer.Tick += (_, _) =>
        {
            ticks++;
            Diagnostics.Trace($"Smoke tick {ticks}: viewer={viewer.ActualWidth:0}x{viewer.ActualHeight:0} scroll={(viewer.Child as System.Windows.Controls.ScrollViewer)?.ActualWidth:0}x{(viewer.Child as System.Windows.Controls.ScrollViewer)?.ActualHeight:0}");
            if (ticks >= 3)
            {
                timer.Stop();
                Diagnostics.Trace("Smoke: done");
                Close();
            }
        };
        timer.Start();
    }
}
