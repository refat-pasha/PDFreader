using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using PDFreader.Core;
using PDFreader.Core.Models;

namespace PDFreader.App;

/// <summary>
/// One document view: a scrollable page image plus an ink/shape overlay.
/// Rendering happens on a background thread through PdfRenderer (PDFium).
/// </summary>
public sealed class PageViewer : Border
{
    private readonly DocumentInfo _doc;
    private readonly PdfRenderer _renderer;
    private readonly PdfService _pdf;
    private readonly Dictionary<string, string> _passwords;
    private readonly Workspace _workspace;

    private readonly ScrollViewer _scroll;
    private readonly Grid _pageHost;
    private readonly Image _pageImage;
    private readonly Canvas _overlay;
    private readonly TextBlock _busy;

    private CancellationTokenSource? _renderGeneration;
    private int _renderedPage = -1;
    private double _renderedZoom = -1;
    private int _renderedRotation = -1;

    public int Page { get; private set; } = 1;
    private double _zoom = 1.0;
    private ZoomMode _mode = ZoomMode.FitPage;
    private int _rotation;

    // Ink state
    private ToolMode _tool = ToolMode.Select;
    private string _color = "#F7768E";
    private double _strokeWidth = 2.0;
    private System.Windows.Point _dragStart;
    private System.Windows.Point _lastPoint;
    private bool _drawing;
    private System.Windows.Shapes.Polyline? _inkStroke;
    private System.Windows.Shapes.Shape? _previewShape;
    private readonly List<System.Windows.Point> _inkPoints = new();

    public PageViewer(DocumentInfo doc, PdfRenderer renderer, PdfService pdf,
        Dictionary<string, string> passwords, Workspace workspace)
    {
        Diagnostics.Trace("PageViewer ctor begin");
        _doc = doc;
        _renderer = renderer;
        _pdf = pdf;
        _passwords = passwords;
        _workspace = workspace;

        Child = _scroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Background = new SolidColorBrush(Color.FromRgb(0x14, 0x16, 0x1B)),
            Padding = new Thickness(12),
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
        };

        _pageHost = new Grid
        {
            Background = new SolidColorBrush(Color.FromRgb(0x14, 0x16, 0x1B)),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        // Center via container alignment; explicit Width/Height set after render.
        // Stretch=Uniform: the supersampled bitmap scales INTO the explicit
        // Width/Height box (2:1 downscale). Stretch=None would draw the bitmap
        // at its metadata-derived natural size and CLIP it to the box — the
        // cause of the "page cut off at the right edge" bug.
        _pageImage = new Image
        {
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _overlay = new Canvas
        {
            IsHitTestVisible = true,
            Background = Brushes.Transparent,
        };
        _pageHost.Children.Add(_pageImage);
        _pageHost.Children.Add(_overlay);
        _scroll.Content = _pageHost;

        _busy = new TextBlock
        {
            Text = "Rendering…",
            Foreground = new SolidColorBrush(Color.FromRgb(0x9B, 0xA0, 0xAF)),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        _overlay.MouseDown += OnOverlayDown;
        _overlay.MouseMove += OnOverlayMove;
        _overlay.MouseUp += OnOverlayUp;
        _overlay.MouseWheel += OnOverlayWheel;
        _scroll.PreviewMouseWheel += OnScrollWheel;

        _workspace.StateChanged += () => Dispatcher.BeginInvoke(RedrawAnnotations);
        // Fit modes need the real viewport; re-render when the layout settles.
        _scroll.SizeChanged += (_, args) =>
        {
            // Debounce: skip re-renders during drag-resize; only react when
            // the width moved by more than 60px (or 8% on narrow viewports).
            var delta = Math.Abs(args.NewSize.Width - _lastViewportWidth);
            if (args.NewSize.Width > 40 && _mode != ZoomMode.Custom &&
                (delta > 60 || delta > args.NewSize.Width * 0.08))
            {
                _lastViewportWidth = args.NewSize.Width;
                Diagnostics.Trace($"ScrollViewer SizeChanged -> re-render ({args.NewSize.Width:0}x{args.NewSize.Height:0})");
                RenderPage(force: true);
            }
        };
        Diagnostics.Trace("PageViewer ctor: calling RenderPage");
        RenderPage();
        Diagnostics.Trace("PageViewer ctor: RenderPage returned");
        // Layout timing varies (TabControl realizes content asynchronously);
        // retry until the viewer has a real viewport, then fit once more.
        var retries = 0;
        System.Windows.Threading.DispatcherTimer layoutWatch = null!; // assigned below
        layoutWatch = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
        layoutWatch.Tick += (_, _) =>
        {
            retries++;
            if (ActualWidth > 40)
            {
                layoutWatch.Stop();
                Diagnostics.Trace($"layout ready after {retries} ticks (viewport={ActualWidth:0}x{ActualHeight:0})");
                if (_mode != ZoomMode.Custom)
                    RenderPage(force: true);
            }
            else if (retries >= 40)
            {
                layoutWatch.Stop();
                Diagnostics.Trace("layout watch gave up");
            }
        };
        layoutWatch.Start();
    }

    private double _lastViewportWidth;

    public enum ToolMode { Select, Ink, Highlighter, Rectangle, Ellipse, Arrow, Text, Note, Eraser }

    public void SetTool(ToolMode tool) => _tool = tool;
    public void SetToolColor(string color) => _color = color;
    public void SetStrokeWidth(double width) => _strokeWidth = width;

    public void GoToPage(int page)
    {
        page = Math.Clamp(page, 1, _doc.PageCount);
        if (page == Page) return;
        Page = page;
        RenderPage();
        // A new page always starts at its top-left; never inherit the
        // previous page's scroll offset (buttons, wheel, thumbnails, etc.).
        _scroll.ScrollToTop();
        _scroll.ScrollToHorizontalOffset(0);
        PageChanged?.Invoke(Page);
    }

    /// <summary>True when the viewer consumed the key (page turn).</summary>
    public bool HandleKey(Key key)
    {
        switch (key)
        {
            case Key.PageDown or Key.Next:
                if (Page < _doc.PageCount) { GoToPage(Page + 1); return true; }
                return false;
            case Key.PageUp or Key.Prior:
                if (Page > 1) { GoToPage(Page - 1); return true; }
                return false;
            case Key.Home:
                GoToPage(1); return true;
            case Key.End:
                GoToPage(_doc.PageCount); return true;
            default:
                return false;
        }
    }

    public event Action<int>? PageChanged;
    public event Action<int>? Rendered;
    /// <summary>Raised for Ctrl+wheel zoom; the window applies it so toolbar/percent stay in sync.</summary>
    public event Action<bool>? ZoomRequested;

    /// <summary>
    /// Viewport size the last render was computed against. MainWindow sets this
    /// before calling ApplyZoomMode so fit modes use the real space available
    /// to the viewer (rail + side panel already excluded).
    /// </summary>
    public Size ExternalViewport { get; set; }

    /// <summary>The zoom actually applied by the last render (fit modes recompute it).</summary>
    public double EffectiveZoom => _zoom;

    // ------------------------------------------------------------- wheel input

    /// <summary>
    /// Plain wheel: turn pages. The wheel scrolls the viewport when the page
    /// overflows it and flips to the next/previous page at the edges.
    /// Ctrl+wheel: zoom (delegated to the window).
    /// </summary>
    private void OnScrollWheel(object sender, MouseWheelEventArgs e)
    {
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            e.Handled = true;
            ZoomRequested?.Invoke(e.Delta > 0);
            return;
        }

        // Page fully visible (fit modes): wheel = page turn.
        if (_scroll.ScrollableHeight <= 0 && _scroll.ScrollableWidth <= 0)
        {
            e.Handled = true;
            TurnPage(e.Delta > 0 ? -1 : 1);
            return;
        }

        // Zoomed in: scroll the viewport; flip page only when already at the edge.
        bool atBottom = _scroll.VerticalOffset >= _scroll.ScrollableHeight - 1;
        bool atTop = _scroll.VerticalOffset <= 1;
        if (e.Delta < 0 && atBottom && !atTop)
        {
            e.Handled = true;
            TurnPage(1);
        }
        else if (e.Delta > 0 && atTop && !atBottom)
        {
            e.Handled = true;
            TurnPage(-1);
        }
        // Otherwise let the ScrollViewer scroll naturally.
    }

    private void TurnPage(int direction)
    {
        var target = Page + direction;
        if (target < 1 || target > _doc.PageCount) return;
        GoToPage(target);
    }

    private void OnOverlayWheel(object sender, MouseWheelEventArgs e) => OnScrollWheel(sender, e);

    public void ApplyZoomMode(ZoomMode mode, double customZoom, double viewportWidth, double viewportHeight = 0)
    {
        _mode = mode;
        _zoom = customZoom;
        // Re-render at new scale. Fit modes compute scale from the rendered page size.
        RenderPage(force: true);
    }

    public void ApplyRotation(int rotation)
    {
        _rotation = rotation % 360;
        RenderPage(force: true);
    }

    public void RestoreState(int page, double zoom, int rotation, ZoomMode mode)
    {
        Page = Math.Clamp(page, 1, _doc.PageCount);
        // A stale/invalid restored zoom must not blow the page up on open:
        // clamp it, and never restore Custom (fall back to FitPage).
        zoom = Math.Clamp(zoom, 0.25, 4.0);
        _zoom = zoom;
        _rotation = rotation;
        _mode = mode == ZoomMode.Custom ? ZoomMode.FitPage : mode;
        RenderPage(force: true);
    }

    private (int widthPx, double pageW, double pageH) ComputeTarget()
    {
        _passwords.TryGetValue(_doc.Path, out var password);
        var (w, h) = _renderer.GetPageSize(_doc.Path, password, Page);
        // Swap for rotation
        if (_rotation is 90 or 270) (w, h) = (h, w);
        // The viewer may not be measured yet (first render) — fall back to the
        // host window's client size so fit modes still produce a usable scale.
        double availW = ActualWidth > 40 ? ActualWidth - 40 : 0;
        double availH = ActualHeight > 40 ? ActualHeight - 30 : 0;
        if (ExternalViewport.Width > 40)
        {
            // Trust the window-supplied viewport (rail/panel already excluded).
            availW = ExternalViewport.Width - 40;
            availH = ExternalViewport.Height - 30;
        }
        else if (availW <= 0 && Window.GetWindow(this) is { } host)
        {
            availW = host.ActualWidth - 320;
            availH = host.ActualHeight - 150;
        }
        double scale;
        if (_mode == ZoomMode.FitWidth && availW > 40)
            scale = availW / w;
        else if (_mode == ZoomMode.FitPage && availW > 40 && availH > 40)
            scale = Math.Min(availW / w, availH / h);
        else
            scale = _zoom;
        scale = Math.Clamp(scale, 0.1, 6.0);
        _zoom = scale;
        // Fixed 2× supersampling: render at twice the logical size and let WPF
        // downscale 2:1. Deterministic on any DPI, avoids all metadata math.
        Diagnostics.Trace($"ComputeTarget: page {w}x{h}pt avail {availW:0}x{availH:0} mode={_mode} scale={scale:0.00}");
        return ((int)Math.Round(w * scale * 2), w, h);
    }

    private void RenderPage(bool force = false)
    {
        int widthPx;
        try
        {
            (widthPx, _, _) = ComputeTarget();
        }
        catch (Exception ex)
        {
            Diagnostics.Trace($"ComputeTarget ERROR: {ex.Message}");
            SetError(ex.Message);
            return;
        }
        if (!force && _renderedPage == Page && Math.Abs(_renderedZoom - _zoom) < 0.001 && _renderedRotation == _rotation) return;

        _renderGeneration?.Cancel();
        var generation = _renderGeneration = new CancellationTokenSource();
        var token = generation.Token;
        var page = Page;
        var rotation = _rotation;
        _pageHost.Children.Remove(_busy);
        _pageHost.Children.Add(_busy);

        _passwords.TryGetValue(_doc.Path, out var password);
        Task.Run(() =>
        {
            try
            {
                Diagnostics.Trace($"render start page={page} width={widthPx}");
                var png = _renderer.RenderPage(_doc.Path, password, page, widthPx, rotation);
                if (token.IsCancellationRequested) return;
                Diagnostics.Trace($"render done page={page} bytes={png.Length}");
                Dispatcher.BeginInvoke(() =>
                {
                    if (token.IsCancellationRequested) return;
                    // Decode at 96dpi so the WPF "natural size" equals the pixel
                    // count — then our explicit Width/Height is a pure 2:1
                    // downscale from the supersampled render. No DPI math.
                    var image = new BitmapImage();
                    using var stream = new MemoryStream(png);
                    image.BeginInit();
                    image.CacheOption = BitmapCacheOption.OnLoad;
                    image.StreamSource = stream;
                    image.EndInit();
                    image.Freeze();
                    _pageImage.Source = image;
                    // Bitmap is 2× the logical size (supersampled). Explicit
                    // logical dimensions give an exact 2:1 downscale.
                    // Logical size comes from the ACTUAL decoded bitmap (2:1
                    // supersample downscale), so the true aspect ratio holds
                    // even after rotation or slight width rounding.
                    var logicalW = image.PixelWidth / 2.0;
                    var logicalH = image.PixelHeight / 2.0;
                    _pageImage.Width = logicalW;
                    _pageImage.Height = logicalH;
                    _pageHost.Width = logicalW;
                    _pageHost.Height = logicalH;
                    _overlay.Width = logicalW;
                    _overlay.Height = logicalH;
                    // Keep page point size in sync for annotation coordinate mapping.
                    try
                    {
                        var (pw, ph) = _renderer.GetPageSize(_doc.Path, _passwords.TryGetValue(_doc.Path, out var pw2) ? pw2 : null, page);
                        _pagePointSize = (pw, ph);
                    }
                    catch { }
                    _renderedPage = page;
                    _renderedZoom = _zoom;
                    _renderedRotation = rotation;
                    _pageHost.Children.Remove(_busy);
                    RedrawAnnotations();
                    Rendered?.Invoke(page);
                });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Diagnostics.Trace($"render ERROR page={Page}: {ex.Message}");
                Dispatcher.BeginInvoke(() =>
                {
                    _pageHost.Children.Remove(_busy);
                    SetError(ex.Message);
                });
            }
        }, token);
    }

    private void SetError(string message)
    {
        _busy.Text = $"Could not render page: {message}";
        if (!_pageHost.Children.Contains(_busy)) _pageHost.Children.Add(_busy);
    }

    // ------------------------------------------------------------ annotations

    /// <summary>Converts overlay px coordinates into unrotated PDF page points.</summary>
    private PointD ToPagePoint(System.Windows.Point p)
    {
        // The overlay renders the rotated page; map back to page points.
        double pxPerPtX, pxPerPtY;
        if (_rotation is 90 or 270)
        {
            pxPerPtX = _overlay.Width / _pagePointSize.H;
            pxPerPtY = _overlay.Height / _pagePointSize.W;
        }
        else
        {
            pxPerPtX = _overlay.Width / _pagePointSize.W;
            pxPerPtY = _overlay.Height / _pagePointSize.H;
        }
        return _rotation switch
        {
            90 => new PointD(p.Y / pxPerPtY, (_overlay.Width - p.X) / pxPerPtX),
            180 => new PointD((_overlay.Width - p.X) / pxPerPtX, (_overlay.Height - p.Y) / pxPerPtY),
            270 => new PointD((_overlay.Height - p.Y) / pxPerPtY, p.X / pxPerPtX),
            _ => new PointD(p.X / pxPerPtX, p.Y / pxPerPtY),
        };
    }

    /// <summary>Maps page points back to overlay px for drawing (re-rotates forward).</summary>
    private System.Windows.Point FromPagePoint(PointD pt)
    {
        double ptPerPxX, ptPerPxY;
        if (_rotation is 90 or 270)
        {
            ptPerPxX = _pagePointSize.H / _overlay.Width;
            ptPerPxY = _pagePointSize.W / _overlay.Height;
        }
        else
        {
            ptPerPxX = _pagePointSize.W / _overlay.Width;
            ptPerPxY = _pagePointSize.H / _overlay.Height;
        }
        return _rotation switch
        {
            90 => new System.Windows.Point((_pagePointSize.H - pt.Y) / ptPerPxX, pt.X / ptPerPxY),
            180 => new System.Windows.Point((_pagePointSize.W - pt.X) / ptPerPxX, (_pagePointSize.H - pt.Y) / ptPerPxY),
            270 => new System.Windows.Point(pt.Y / ptPerPxX, (_pagePointSize.W - pt.X) / ptPerPxY),
            _ => new System.Windows.Point(pt.X / ptPerPxX, pt.Y / ptPerPxY),
        };
    }

    private (double W, double H) _pagePointSize = (612, 792);

    private void OnOverlayDown(object sender, MouseButtonEventArgs e)
    {
        if (_tool == ToolMode.Select) return;
        var position = e.GetPosition(_overlay);
        if (_tool == ToolMode.Eraser)
        {
            EraseAt(position);
            return;
        }
        _dragStart = position;
        _lastPoint = position;
        _inkPoints.Clear();
        _inkPoints.Add(_dragStart);
        if (_tool is ToolMode.Ink or ToolMode.Highlighter)
        {
            _inkStroke = new System.Windows.Shapes.Polyline
            {
                Stroke = new SolidColorBrush((Color)ColorConverter.ConvertFromString(_color)),
                StrokeThickness = _tool == ToolMode.Highlighter ? Math.Max(8, _strokeWidth * 6) : _strokeWidth,
                StrokeLineJoin = PenLineJoin.Round,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                Opacity = _tool == ToolMode.Highlighter ? 0.35 : 1.0,
            };
            _overlay.Children.Add(_inkStroke);
        }
        else if (_tool is ToolMode.Rectangle or ToolMode.Ellipse or ToolMode.Arrow)
        {
            _previewShape = _tool switch
            {
                ToolMode.Rectangle => new System.Windows.Shapes.Rectangle(),
                ToolMode.Ellipse => new System.Windows.Shapes.Ellipse(),
                _ => new System.Windows.Shapes.Line(),
            };
            _previewShape.Stroke = new SolidColorBrush((Color)ColorConverter.ConvertFromString(_color));
            _previewShape.StrokeThickness = _strokeWidth;
            _overlay.Children.Add(_previewShape);
        }
        _drawing = true;
        _overlay.CaptureMouse();
    }

    /// <summary>Removes the topmost annotation whose rendered geometry is within 10 px of the click.</summary>
    private void EraseAt(System.Windows.Point position)
    {
        var pagePoint = ToPagePoint(position);
        double tolerancePt = 10.0 * _pagePointSize.W / Math.Max(1, _overlay.Width);
        var candidates = _workspace.AnnotationsFor(_doc.Id, Page - 1);
        for (var i = candidates.Count - 1; i >= 0; i--)
        {
            if (HitTest(candidates[i], pagePoint, tolerancePt))
            {
                _workspace.RemoveAnnotation(candidates[i].Id);
                return;
            }
        }
    }

    private static bool HitTest(Annotation ann, PointD point, double tolerance)
    {
        bool Near(PointD a, PointD b) =>
            Math.Abs(a.X - b.X) <= tolerance && Math.Abs(a.Y - b.Y) <= tolerance;

        switch (ann.Kind)
        {
            case AnnotationKind.Ink or AnnotationKind.Highlighter:
                return ann.Points.Any(p => Near(p, point));
            case AnnotationKind.Rectangle or AnnotationKind.Ellipse:
            {
                var a = ann.Points[0];
                var b = ann.Points[^1];
                bool inside = point.X >= Math.Min(a.X, b.X) - tolerance && point.X <= Math.Max(a.X, b.X) + tolerance
                            && point.Y >= Math.Min(a.Y, b.Y) - tolerance && point.Y <= Math.Max(a.Y, b.Y) + tolerance;
                bool onEdge = ann.Points.Any(p => Near(p, point));
                return inside || onEdge;
            }
            case AnnotationKind.Arrow:
            {
                var a = ann.Points[0];
                var b = ann.Points[^1];
                // Distance from point to segment.
                var dx = b.X - a.X; var dy = b.Y - a.Y;
                var lengthSq = dx * dx + dy * dy;
                if (lengthSq == 0) return Near(a, point);
                var t = Math.Clamp(((point.X - a.X) * dx + (point.Y - a.Y) * dy) / lengthSq, 0, 1);
                var cx = a.X + t * dx; var cy = a.Y + t * dy;
                return Math.Abs(point.X - cx) <= tolerance && Math.Abs(point.Y - cy) <= tolerance;
            }
            default:
                return false;
        }
    }

    private void OnOverlayMove(object sender, MouseEventArgs e)
    {
        if (!_drawing) return;
        var point = e.GetPosition(_overlay);
        if (_inkStroke is not null)
        {
            _inkPoints.Add(point);
            _inkStroke.Points = new PointCollection(_inkPoints);
        }
        else if (_previewShape is not null)
        {
            var left = Math.Min(_dragStart.X, point.X);
            var top = Math.Min(_dragStart.Y, point.Y);
            var width = Math.Abs(point.X - _dragStart.X);
            var height = Math.Abs(point.Y - _dragStart.Y);
            if (_previewShape is System.Windows.Shapes.Line line)
            {
                line.X1 = _dragStart.X; line.Y1 = _dragStart.Y;
                line.X2 = point.X; line.Y2 = point.Y;
            }
            else
            {
                Canvas.SetLeft(_previewShape, left);
                Canvas.SetTop(_previewShape, top);
                _previewShape.Width = width;
                _previewShape.Height = height;
            }
        }
        _lastPoint = point;
    }

    private void OnOverlayUp(object sender, MouseButtonEventArgs e)
    {
        if (!_drawing) return;
        _drawing = false;
        _overlay.ReleaseMouseCapture();

        var pagePoints = _inkPoints.Select(ToPagePoint).ToList();
        var endPoint = ToPagePoint(_lastPoint);

        if (_inkStroke is not null)
        {
            _overlay.Children.Remove(_inkStroke);
            if (_inkPoints.Count >= 2)
            {
                _workspace.AddAnnotation(new Annotation
                {
                    Id = $"ann-{Guid.NewGuid():N}",
                    DocId = _doc.Id,
                    PageIndex = Page - 1,
                    Kind = _tool == ToolMode.Highlighter ? AnnotationKind.Highlighter : AnnotationKind.Ink,
                    Color = _color,
                    StrokeWidth = _tool == ToolMode.Highlighter ? Math.Max(8, _strokeWidth * 6) : _strokeWidth,
                    Opacity = _tool == ToolMode.Highlighter ? 0.35 : 1.0,
                    Points = pagePoints,
                });
            }
            _inkStroke = null;
        }
        else if (_previewShape is not null)
        {
            _overlay.Children.Remove(_previewShape);
            var start = ToPagePoint(_dragStart);
            var kind = _tool switch
            {
                ToolMode.Rectangle => AnnotationKind.Rectangle,
                ToolMode.Ellipse => AnnotationKind.Ellipse,
                _ => AnnotationKind.Arrow,
            };
            _workspace.AddAnnotation(new Annotation
            {
                Id = $"ann-{Guid.NewGuid():N}",
                DocId = _doc.Id,
                PageIndex = Page - 1,
                Kind = kind,
                Color = _color,
                StrokeWidth = _strokeWidth,
                Points = new List<PointD> { start, endPoint },
            });
            _previewShape = null;
        }
    }

    public void RedrawAnnotations()
    {
        if (_renderedPage <= 0 || _overlay.Width <= 0) return;
        _overlay.Children.Clear();
        foreach (var ann in _workspace.AnnotationsFor(_doc.Id, _renderedPage - 1))
            DrawAnnotation(ann);
    }

    private void DrawAnnotation(Annotation ann)
    {
        // Page-point → overlay px with the current rotation applied.
        System.Windows.Point Map(PointD p) => FromPagePoint(p);

        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(ann.Color));
        switch (ann.Kind)
        {
            case AnnotationKind.Ink or AnnotationKind.Highlighter:
            {
                var poly = new System.Windows.Shapes.Polyline
                {
                    Stroke = brush,
                    StrokeThickness = Math.Max(1, ann.StrokeWidth * _overlay.Width / _pagePointSize.W),
                    Opacity = ann.Opacity,
                    StrokeLineJoin = PenLineJoin.Round,
                    StrokeStartLineCap = PenLineCap.Round,
                    StrokeEndLineCap = PenLineCap.Round,
                };
                poly.Points = new PointCollection(ann.Points.Select(Map));
                _overlay.Children.Add(poly);
                break;
            }
            case AnnotationKind.Rectangle:
            {
                var a = Map(ann.Points[0]);
                var b = Map(ann.Points[^1]);
                _overlay.Children.Add(new System.Windows.Shapes.Rectangle
                {
                    Stroke = brush,
                    StrokeThickness = Math.Max(1, ann.StrokeWidth * _overlay.Width / _pagePointSize.W),
                    Width = Math.Abs(b.X - a.X),
                    Height = Math.Abs(b.Y - a.Y),
                    HorizontalAlignment = HorizontalAlignment.Left,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = new Thickness(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), 0, 0),
                });
                break;
            }
            case AnnotationKind.Ellipse:
            {
                var a = Map(ann.Points[0]);
                var b = Map(ann.Points[^1]);
                _overlay.Children.Add(new System.Windows.Shapes.Ellipse
                {
                    Stroke = brush,
                    StrokeThickness = Math.Max(1, ann.StrokeWidth * _overlay.Width / _pagePointSize.W),
                    Width = Math.Abs(b.X - a.X),
                    Height = Math.Abs(b.Y - a.Y),
                    HorizontalAlignment = HorizontalAlignment.Left,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = new Thickness(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), 0, 0),
                });
                break;
            }
            case AnnotationKind.Arrow:
            {
                var a = Map(ann.Points[0]);
                var b = Map(ann.Points[^1]);
                _overlay.Children.Add(new System.Windows.Shapes.Line
                {
                    X1 = a.X, Y1 = a.Y, X2 = b.X, Y2 = b.Y,
                    Stroke = brush,
                    StrokeThickness = Math.Max(1, ann.StrokeWidth * _overlay.Width / _pagePointSize.W),
                });
                break;
            }
        }
    }

    public void SetPageSize((double W, double H) size) => _pagePointSize = size;

    /// <summary>Stamps an image at the center of the current page (annotation kind Image).</summary>
    public void InsertImageStamp(string imagePath)
    {
        if (!File.Exists(imagePath)) throw new FileNotFoundException(imagePath);
        var bytes = File.ReadAllBytes(imagePath);
        // Default placement: center at half page size.
        var (w, h) = _pagePointSize;
        _workspace.AddAnnotation(new Annotation
        {
            Id = $"ann-{Guid.NewGuid():N}",
            DocId = _doc.Id,
            PageIndex = Page - 1,
            Kind = AnnotationKind.Image,
            Color = "#FFFFFF",
            Points = new List<PointD> { new(w / 4, h / 4), new(w * 3 / 4, h * 3 / 4) },
            ImageData = bytes,
        });
    }

    /// <summary>Exports the current document with annotations flattened via page images.</summary>
    public void ExportAnnotatedPdf(string targetPath)
    {
        _passwords.TryGetValue(_doc.Path, out var password);
        PdfFlattenExporter.Export(_renderer, _pdf, _doc.Path, password, _doc.PageCount, targetPath,
            _workspace.Annotations.Where(a => a.DocId == _doc.Id).ToList());
    }
}
