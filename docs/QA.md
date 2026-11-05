# QA and manual test plan

## Automated

```powershell
pnpm test                     # 32 unit/export tests (Vitest)
pnpm build                    # tsc + Vite production build
cargo test --manifest-path src-tauri/Cargo.toml   # 9 native tests (I/O + PDFium + Windows OCR)
pnpm tauri build              # Rust compile + NSIS packaging
powershell -File scripts/verify-release.ps1       # installer/manifest/resource/association checks
```

Browser smoke scripts require a headless Chrome with `--remote-debugging-port=9222`:

```powershell
node scripts/ui-smoke.mjs http://127.0.0.1:1420 tests/.artifacts/app.png
node scripts/ui-actions.mjs http://127.0.0.1:1420
```

`ui-actions` checks drawing, split view, notes, and export modal flow.

## Release checklist

### Reading

- [ ] Open a PDF through the dialog and through the demo.
- [ ] Open two PDFs; switch tabs; verify page and zoom state.
- [ ] Split into two panes; verify both render and navigate independently.
- [ ] Drag the divider and use arrow keys on the focused divider; verify both panes resize with minimum widths preserved.
- [ ] Change page, zoom, and rotation; fully restart the desktop app; verify the workspace and positions restore. Missing files must be skipped with a message.
- [ ] Fit page, fit width, custom zoom, rotate, and page-wheel navigation.
- [ ] Open a PDF in the desktop app; verify the page count is obtained successfully.
- [ ] Scroll the thumbnail sidebar; verify native PDFium thumbnails render lazily.
- [ ] Temporarily rename the bundled PDFium DLL; verify the app falls back to PDF.js without failing to open.
- [ ] Right-click a tab with multiple PDFs open; verify close, close others, and close all. Verify middle-click closes one tab.
- [ ] Open a password-protected PDF; verify the prompt, incorrect-password retry, successful unlock, and that the password is not written to disk.
- [ ] Search a term, open a result, and verify the matching text is highlighted on the page.
- [ ] Open two PDFs, switch search scope to **All open**, and verify results are labeled with their source document and jump to the right tab/page.
- [ ] Thumbnail click and search result click jump to the correct page.
- [ ] Password-protected PDF reports a clear error rather than a blank page.

### Annotations and notes

- [ ] Draw pen, highlighter, rectangle, ellipse, arrow, text, note, and image stamp.
- [ ] Select text with the Select tool; use the floating Highlight action.
- [ ] Select text and use **Quote in note**; verify the notebook opens with a quote and page backlink.
- [ ] Export all notes as Markdown; verify titles, bodies, and linked pages are present.
- [ ] Undo and redo each creation/deletion.
- [ ] Select and drag an annotation; delete with Delete.
- [ ] Use the eraser tool to click a mark; verify the mark and its markup count disappear.
- [ ] Change size, color, and opacity; verify palette persists per tool.
- [ ] Create a note, link a page, and jump back through the backlink.
- [ ] Reload the app; verify drafts and notes survive.

### Export

- [ ] Export annotated PDF; open it in another PDF reader.
- [ ] Export Markdown and TXT; verify page headings, text, and note summary.
- [ ] Export DOCX in editable mode; verify flowing text and note appendix.
- [ ] Export DOCX in visual mode; verify annotated page images and note appendix.
- [ ] Export PNG (single page) and ZIP (multiple pages).
- [ ] With LibreOffice installed, export `.doc`; otherwise verify the clear DOCX fallback warning.
- [ ] With Windows OCR language installed, OCR a scanned page in Markdown/DOCX export; otherwise verify the clear warning.
- [ ] With Tesseract installed, verify it can be used for an additional language.
- [ ] Cancel the save dialog; verify no file is written.
- [ ] Try a read-only destination; verify no partial file remains.

### Page organizer

- [ ] Rotate, reorder, and delete pages; create the edited copy.
- [ ] Verify the edited copy opens with the expected page order and rotations.
- [ ] Verify the original file is unchanged.
- [ ] Verify page 1 cannot be deleted from a one-page document.

### Desktop

- [ ] Installer registers PDFreader in Open With.
- [ ] Double-click a PDF while PDFreader is closed; it opens in a new window.
- [ ] Double-click a PDF while PDFreader is running; the existing window focuses and receives it.
- [ ] "Choose default PDF app" opens Windows default apps settings.
- [ ] Window size/position restore on relaunch.
- [ ] Close a tab and reopen the file; markup drafts restore.
- [ ] Process killing the app does not corrupt the original PDF.

### Accessibility and display

- [ ] Open Export, Settings, Page organizer, Shortcuts, and Command palette; verify focus starts inside, Tab stays trapped, Escape closes, and focus returns to the triggering control.
- [ ] Visible focus ring on every control.
- [ ] Screen-reader labels for icon-only buttons and live page announcements.
- [ ] 100%, 125%, 150%, and 200% display scaling.
- [ ] Light theme, dark theme, and Windows high-contrast mode.
- [ ] Reduced-motion preference disables shimmer/spin animation.

## Performance smoke

Measure the application process tree on a documented reference machine, not this benchmark alone.

Targets for v0.1:

- Single 100-page digital PDF, fit page: ≤350 MB private working set.
- Two panes of the same document: ≤500 MB.
- Cold open of the demo: under 2.5 s to usable canvas.
- No canvas render errors during rapid page changes.
- Thumbnails render lazily and off-screen canvases are released.

Known limitation: PDF.js keeps a document copy in its worker; multi-gigabyte PDFs need the native range-renderer milestone.

## Failure injection

- [ ] Corrupt local-storage JSON: app still starts.
- [ ] Malformed PDF: friendly error, other tabs unaffected.
- [ ] Read a non-PDF through the native command: rejected by extension/size check.
- [ ] Write an unsupported extension: rejected.
- [ ] LibreOffice missing: `.doc` export falls back cleanly.
- [ ] Tesseract missing: OCR warning, no silent success.
- [ ] Native engine crash: not currently applicable to PDF.js; worker failure surfaces an error.
