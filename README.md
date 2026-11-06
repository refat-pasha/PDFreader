# PDFreader

A native Windows desktop workspace for reading PDFs — open several documents side by side, draw on pages, keep linked notes, and export annotated or converted copies.

PDFreader is built with **.NET 10 + WPF**, renders pages with the **PDFium** engine (via PDFtoImage), and parses text, outlines, and passwords with **PdfPig**. It has **no WebView2 and no browser runtime dependency** — the UI is drawn with native Windows controls, so it runs on machines where Chromium-based viewers fail to start. Documents stay local; everything works offline.

![PDFreader workspace](docs/assets/workspace.png)

Text selection is a first-class reading action, and annotations are drawn on a transparent overlay above each page. "Save annotated copy" flattens your marks into a regular PDF you can share.

## What works today

- **Reading:** tabs, fit-page/fit-width/custom zoom, rotation, page input, prev/next, Page Up/Page Down/Home/End keys, **mouse-wheel page turns**, **Ctrl+wheel zoom**, drag-and-drop, and command-line/file-association opening.
- **Annotations:** pen, highlighter, rectangle, ellipse, arrow, and an eraser that deletes the mark under the cursor. Six colors, undo/redo. Marks are stored in PDF page-point coordinates so they follow the page across zoom and rotation.
- **Annotated PDF export:** every page is re-rendered through PDFium and the marks are burned into the raster — the exported file looks exactly like the on-screen view.
- **Search:** full-text search across all open documents with page jumps.
- **Sidebar:** page thumbnails (rendered on demand), the PDF's real outline/bookmarks, labeled page bookmarks, and a Markdown notebook.
- **Notes:** Markdown notebook with page-linked backlinks, "quote selection into note" flow, standalone Markdown/DOCX notebook export.
- **Password-protected PDFs:** unlock dialog with retry; passwords live in memory for the session only and are never written to disk.
- **Session recovery:** open documents, page positions, zoom, and rotation are restored on the next launch.
- **Recent files:** last ten documents, offered in File → Open Recent.
- **Other exports:** current page → PNG, page text → TXT, notebook → DOCX (OpenXML).

## Install

Grab the latest build from [GitHub Releases](https://github.com/refat-pasha/PDFreader/releases):

- **`PDFreader_0.2.0_x64-setup.exe`** — per-user installer. No admin required; installs to `%LOCALAPPDATA%\Programs\PDFreader`, adds Start Menu shortcuts, and registers a `.pdf` viewer entry (Windows still asks you to confirm the default app in Settings → Default apps).
- **`PDFreader-0.2.0-portable.zip`** — self-contained build; unzip anywhere and run `PDFreader.exe`. No .NET installation needed.

> **Install tip:** save the installer somewhere outside a sandboxed or permission-restricted folder (your **Downloads** folder is ideal). Installers need to create temp files, and a folder with inherited restrictive ACLs can make setup fail with *"Error writing temporary file"* or *"unable to create the directory … Error 5: Access is denied."*

The build is unsigned, so Windows SmartScreen may show a warning — choose **More info → Run anyway** if you trust it. SHA-256 checksums are attached to each release.

## Build from source

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

CI (`.github/workflows/ci.yml`) builds the solution and runs the full test suite on every push.

## Why a .NET rewrite?

The first version of PDFreader was a Tauri 2 app. Tauri renders its UI through the WebView2 runtime, and on some Windows 11 hosts (notably Insider build 26200) WebView2's Chromium processes abort at startup — the window opens and immediately dies. That failure mode is documented in `docs/webview2-compat.md`; it reproduces with the stable runtime, the fixed-version runtime, and the newest preview runtimes, and is unrelated to the app itself.

The .NET rewrite removes that dependency class entirely: WPF draws with DirectX through Microsoft's own stack, PDFium is the only third-party native component, and the app now runs on the same machine where the WebView2 build could not start. The Tauri-era source (React/TypeScript frontend, Rust backend) has been removed from the repository; it lives in the git history and its binaries are archived on the releases page.

## Notes and limitations

- Thumbnails render lazily and are capped at 200 pages in the sidebar (huge documents stay responsive; the main viewer handles any page count).
- Annotation marks are flattened into exported PDFs; editing the original file's text is not supported.
- OCR for scanned pages is not yet wired into the .NET version (the Tauri version had Windows OCR integration).
- The build is unsigned; there is no code-signing certificate yet.

## Making a release

```powershell
# 1. Publish the self-contained build (run this OUTSIDE any sandboxed workspace)
dotnet publish dotnet/PDFreader.App -c Release -r win-x64 --self-contained true -o dotnet/publish

# 2. Compile the installer (Inno Setup 6)
"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" dotnet/setup.iss

# 3. Package the portable build and publish the release
Compress-Archive -Path dotnet/publish/* -DestinationPath PDFreader-0.2.0-portable.zip
```

The `setup.iss` script installs per-user (`PrivilegesRequired=lowest`), creates Start Menu/desktop shortcuts, writes the `PDFreader.pdf` ProgID with an `OpenWithProgids` entry under HKCU, and never touches `UserChoice`.

## History

- **0.1.0** — Tauri 2 + React/TypeScript version (archived; binaries on the [releases page](https://github.com/refat-pasha/PDFreader/releases)).
- **0.2.0** — native .NET 10 WPF rewrite (this codebase).
