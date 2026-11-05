# Changelog

## 0.1.0 — 2026-11-05

Initial functional build.

### Added

- Tab context menu with close, close other tabs, and close all; middle-click closes a tab.
- Password-protected PDF unlocking with in-memory-only password caching and retry feedback.
- Recent-file menu and command-palette reopening, persisted separately from the workspace session.
- Built-in Windows OCR fallback (no external install) plus optional Tesseract.
- All dialogs now trap focus, focus their first control, close with Escape, and restore trigger focus.
- Standalone notebook Markdown export.
- Eraser tool removes annotations on click; text-field undo no longer triggers document undo.
- Labeled page bookmarks with sidebar navigation and restart persistence.
- Quote selected page text directly into the linked Markdown notebook.
- Settings panel reporting native PDFium, LibreOffice, Tesseract, and app/OS availability.
- Release verification script covering installer checksum, PDFium resources, and `.pdf` association registration.
- Cross-document search across all open PDFs with source labels and cross-tab jumps.
- Resizable split panes with draggable and keyboard-accessible dividers.
- Desktop session recovery: open local PDFs, tabs, split panes, and reading positions restore after a restart.
- Bundled native PDFium 8138 backend for desktop page counts and thumbnails, with automatic PDF.js fallback.
- Multi-document tabs and 1–4 pane workspace with independent navigation.
- PDF.js viewer with fit-page/fit-width/custom zoom, rotation, page input, wheel page turn, keyboard shortcuts, lazy thumbnails, real PDF outline, selectable text/copy, search with in-page highlighting, and local search.
- Annotation engine with text-selection highlighting, pen, highlighter, shapes, arrows, text, margin notes, image stamps, selection/move, eraser, color/size/opacity palette, and undo/redo.
- Markdown notebook with page links and local persistence.
- Annotated PDF export with flattened visual markup, editable/visual DOCX export, optional Word 97 conversion through LibreOffice, Markdown, TXT, PNG, and multi-page ZIP.
- Optional Tesseract OCR path for exports.
- Page organizer with reorder, rotate, and delete.
- Tauri native file I/O, atomic export writes, single-instance path forwarding, PDF association configuration, window state, and NSIS packaging.
- Automated unit tests for geometry, annotations, workspace state, page operations, PDF export, and DOCX structure.
- CDP browser smoke and interaction scripts.
- Architecture, QA, shortcut, release, licensing, and WebView2 compatibility documentation.

### Known issues

- WebView2 156.x crashes on Windows 11 build 26200 in this test environment; a fixed-runtime compatibility path and documentation are included.
- PDF text is not directly editable.
- PDF annotations are flattened on export rather than preserved as native editable PDF annotation objects.
- Secure redaction and digital signatures are not implemented.
- OCR and Word 97 require optional external components.
