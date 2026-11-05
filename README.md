# PDFreader

A native Windows desktop workspace for reading PDFs — open several documents side by side, draw on pages, keep linked notes, and export annotated or converted copies.

PDFreader is built with **.NET 10 + WPF**, renders pages with the **PDFium** engine (via PDFtoImage), and parses text, outlines, and passwords with **PdfPig**. It has **no WebView2 and no browser runtime dependency** — the UI is drawn with native Windows controls, so it runs on machines where Chromium-based viewers fail to start. Documents stay local; everything works offline.

![PDFreader workspace](docs/assets/workspace.png)

Text selection is a first-class reading action, and annotations are drawn on a transparent overlay above each page. "Save annotated copy" flattens your marks into a regular PDF you can share.

## What works today

- **Reading:** tabs, fit-page/fit-width/custom zoom, rotation, page input, prev/next, Page Up/Page Down/Home/End keys, drag-and-drop, and command-line/file-association opening.
- **Annotations:** pen, highlighter, rectangle, ellipse, arrow, and an eraser that deletes the mark under the cursor. Six colors, undo/redo. Marks are stored in PDF page-point coordinates so they follow the page across zoom and rotation.
- **Annotated PDF export:** every page is re-rendered through PDFium and the marks are burned into the raster — the exported file looks exactly like the on-screen view.
- **Search:** full-text search across all open documents with page jumps.
- **Sidebar:** page thumbnails (rendered on demand), the PDF's real outline/bookmarks, labeled page bookmarks, and a Markdown notebook.
- **Notes:** Markdown notebook with page-linked backlinks, "quote selection into note" flow, standalone Markdown/DOCX notebook export.
- **Password-protected PDFs:** unlock dialog with retry; passwords live in memory for the session only and are never written to disk.
- **Session recovery:** open documents, page positions, zoom, and rotation are restored on the next launch.
- **Recent files:** last ten documents, offered in File → Open Recent.
- **Other exports:** current page → PNG, page text → TXT, notebook → DOCX (OpenXML).

## Build

Requires the [.NET 10 SDK](https://dotnet.microsoft.com/download) with the Windows Desktop runtime (any Windows 10/11 x64 machine).

```powershell
dotnet build dotnet/PDFreader.App          # build the app
dotnet build dotnet/PDFreader.Tests        # build tests
dotnet exec dotnet/PDFreader.Tests/bin/Debug/net10.0/PDFreader.Tests.dll   # run all tests in-process
```

The test suite (17 tests) runs PDFium for real — rendering pages, opening an encrypted fixture with a password, extracting text, and writing a flattened annotated PDF.

Run the app:

```powershell
dotnet\PDFreader.App\bin\Debug\net10.0-windows\PDFreader.exe            # empty start
dotnet\...\PDFreader.exe "C:\path\to\document.pdf"                      # open a file
```

Passing a PDF path on the command line is the same entry point Windows uses when you associate `.pdf` files with the app.

## Project layout

```
dotnet/
├─ PDFreader.App/     WPF UI: main window, page viewer, dialogs, exporters
├─ PDFreader.Core/    Testable logic: workspace state, PDF service, persistence, exports
└─ PDFreader.Tests/   xUnit tests with an in-process runner (dotnet exec)
```

CI (`.github/workflows/ci.yml`) builds and tests all three components on every push.

## Why a .NET rewrite?

The first version of PDFreader was a Tauri 2 app. Tauri renders its UI through the WebView2 runtime, and on some Windows 11 hosts (notably Insider build 26200) WebView2's Chromium processes abort at startup — the window opens and immediately dies. That failure mode is documented in `docs/webview2-compat.md`; it reproduces with the stable runtime, the fixed-version runtime, and the newest preview runtimes, and is unrelated to the app itself.

The .NET rewrite removes that dependency class entirely: WPF draws with DirectX through Microsoft's own stack, PDFium is the only third-party native component, and the app now runs on the same machine where the WebView2 build could not start.

The original Tauri source is still in this repository under `src/` and `src-tauri/` for reference; the WPF app in `dotnet/` is the active codebase.

## Notes and limitations

- Thumbnails render lazily and are capped at 200 pages in the sidebar (huge documents stay responsive; the main viewer handles any page count).
- Annotation marks are flattened into exported PDFs; editing the original file's text is not supported.
- The Windows installer (with `.pdf` file association) is planned; for now run the exe directly or associate it manually via Settings → Default apps.
- OCR for scanned pages is not yet wired into the .NET version (the Tauri version had Windows OCR integration).

## History

- **0.1.0** — Tauri 2 + React/TypeScript version (archived; binaries on the [releases page](https://github.com/refat-pasha/PDFreader/releases)).
- **0.2.0** — native .NET 10 WPF rewrite (this codebase).
