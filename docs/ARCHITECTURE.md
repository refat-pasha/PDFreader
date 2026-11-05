# Architecture

## Runtime shape

```text
React 19 workspace
  ├─ Zustand workspace store (tabs, panes, notes, markup, history)
  ├─ PDF.js render worker (page bitmaps and text extraction)
  ├─ annotation SVG layer over the rendered page
  └─ exporters (pdf-lib, docx, JSZip, browser Canvas)
             │
Tauri 2 Rust shell
  ├─ read_file / write_file (validated, size-limited, atomic writes)
  ├─ single-instance path forwarding → `open-paths` event
  ├─ PDF/DOCX legacy conversion via LibreOffice (optional)
  ├─ OCR via Windows built-in OCR (zero-install) or Tesseract (optional)
  └─ platform capability reporting
```

## Decisions

### PDF.js for interactive rendering, PDFium for the native backend

The approved plan started with a PDFium-first proof gate and explicitly allowed an Apache-licensed PDF.js fallback if the native engine could not satisfy the first milestone. The viewer uses PDF.js for interactive page canvases, text selection, search, and accessibility because its text layer and cancellation model are mature.

The desktop app now bundles **PDFium 8138** and uses `pdfium-render` for native page counting and thumbnail rendering. Native calls are serialized through one engine instance because PDFium is not thread-safe. If the DLL is unavailable or a document fails in PDFium, the app falls back to PDF.js. See [ADR 0002](adr/0002-native-pdfium-backend.md).

The renderer/annotation geometry remains isolated in `src/features/viewer/pdfjs.ts` and `src/features/workspace/geometry.ts`, so the main page renderer can move to PDFium without changing annotation data or workspace state.

Tradeoff: PDF.js copies document bytes into its worker. For multi-gigabyte documents this is a known memory limit; the next engineering milestone should add PDFium range-based rendering and a native text layer.


### Canvas + SVG annotations

Pages render to canvas because PDF.js produce fast bitmap output. A separate SVG overlay handles pointer drawing and selection. Coordinates are converted with one set of helpers so zoom, device scale, and page rotation cannot move saved markup. Annotations remain a typed local draft model; PDF export flattens the visual result and can include a reading-notes appendix.

### One pane per view, shared document sessions

Tabs and panes are views. The same document can appear in more than one pane with independent page, zoom, rotation, and scroll state. Drafts are keyed by document metadata, not by a transient pane.

### Local-first state

Annotations, notes, tool preferences, theme, export options, and the reopenable workspace session use a versioned local-storage record. The session stores only local paths and the generated demo; browser file handles are deliberately excluded because they cannot be reopened after a restart. Writes are debounced; a malformed record is ignored. A future revision should move this to SQLite plus a native draft journal once documents can be edited in place.

### Native file boundary

`read_file` validates canonical paths, regular-file status, PDF extension, and a 1 GiB cap. `write_file` allows only known export extensions, limits payload size, writes a temporary file in the destination directory, flushes it, and swaps it atomically with a backup fallback. The frontend never opens raw OS files directly in Tauri.

### PDF association

The NSIS bundle declares the `.pdf` association. Windows 10/11 intentionally requires the user to choose a default handler; the Settings dialog opens the system default-apps page. The app never edits the protected `UserChoice` registry key.

## Security boundaries

- CSP disallows remote scripts; the worker is bundled.
- PDF JavaScript, embedded file launch actions, and remote content are not enabled by the viewer.
- No shell plugin is exposed to the webview.
- LibreOffice/Tesseract processes use argument arrays, fixed filters, temporary working directories, and no shell.
- Windows OCR runs on one dedicated worker thread with a single WinRT engine; repeated creation is avoided because the runtime crashed when engines were repeatedly initialized in-process.
- OCR language strings and exported file extensions are validated.
- Network is optional and only used for updates/download instructions outside the current build.

## Performance rules

- Only the active page is fully rendered in the main viewer.
- Thumbnails render only while intersecting the sidebar viewport and release off-screen canvases.
- Page renders are serialized per canvas; stale renders are cancelled and awaited before replacement.
- Closing a tab releases its page runtime and cached bytes while keeping local drafts for reopening.
- Search extracts text page by page and caps results at 200 per query.

## Data format

The versioned local record contains:

```text
version
theme, toolColors, toolWidths, toolOpacity, exportOptions, syncScroll
notes[{id,title,body,links[{docId,docName,pageIndex,annotationId}],createdAt,updatedAt}]
annotations[{docKey,id,pageIndex,kind,color,opacity,strokeWidth,points,text,fontSize,imageData,createdAt,updatedAt}]
```

`points` use PDF page coordinates with a bottom-left origin. This is the canonical representation; display and export transforms are derived.

## Future upgrades, in priority order

1. Native PDFium page renderer and range-based file reader.
2. SQLite draft journal with crash-safe recovery and annotation schema migration.
3. Real text selection/highlighting with text-layer quads.
4. In-place update preservation (annotations as native PDF objects + incremental save), signature-aware save policy.
5. Native PDF print pipeline.
6. OCR pack installer and searchable-PDF export.
7. Commercial-fidelity DOCX conversion adapter.
