# ADR 0002: Native PDFium backend

- **Status:** Accepted
- **Date:** 2026-11-05
- **Context:** ADR 0001 selected PDF.js as the first renderer because it provided the fastest path to a working workspace. The approved plan also calls for a native PDF backend. Page counting and thumbnail rendering are safe places to introduce PDFium without replacing the text/annotation layer.
- **Decision:**
  - Bundle PDFium (pinned upstream Chromium build 8138, x64 Windows) under `src-tauri/resources/pdfium`.
  - Use `pdfium-render` behind one serialized engine instance.
  - Use PDFium for native page counts when opening local documents and for native thumbnail PNG rendering.
  - Keep PDF.js for interactive page canvases and text extraction until the engine interface and text layer are proven together.
  - Fall back to PDF.js when the DLL is missing, cannot be loaded, or fails a document.
- **Consequences:**
  - The desktop app now has a native document backend and validates PDFs before PDF.js opens them.
  - Thumbnails can be produced without a PDF.js render task.
  - Installer size grows by the ~7.8 MB DLL plus license files.
  - PDFium and PDF.js pagination/rendering can theoretically differ; the PDF.js probe remains the fallback and should be retained until the native path is validated across the corpus.
  - PDFium is not thread-safe; all native calls are serialized by a global engine mutex.
- **Follow-up:** Move the main page renderer and text layer to PDFium in a later milestone, then remove the duplicated document probes. Benchmark startup and memory on the reference corpus.
