# Verification report — 2026-11-05

## Environment

- Windows 11 Pro 10.0.26200 (x64)
- Node.js 24.21.0, pnpm 11.28.5
- Rust 1.99.1 MSVC, Visual Studio 2022 Build Tools 17.14
- Tauri 2.12.5, WebView2 Runtime 156.0.4314.58
- PDF.js 5.7.284
- Chrome 156 headless for browser verification

## Passing checks

| Check | Result |
|---|---|
| `tsc --noEmit` | pass |
| `vitest run` | **33/33 tests pass** |
| `cargo test` | **9/9 native tests pass**, including PDFium rendering, Windows OCR, path validation, and atomic writes |
| `cargo check` | pass |
| Production web build | pass; heavy exporters lazy-loaded into separate chunks |
| Browser UI smoke | one canvas, 14 selectable text spans, 7-page demo, no console errors |
| Text selection/highlight | selection toolbar opens, highlights are created and rendered |
| Quote to note | selected text produced note “Quote — page 1” with quoted body and page link; notebook panel opened |
| Page bookmarks | added “Start” (p.1) and “Details” (p.2), reloaded, both restored, first bookmark jumped to page 1 |
| Notebook export | all notes export as Markdown with titles, bodies, and linked pages |
| Dialog accessibility | initial focus is inside the Export dialog (`role=dialog`); Escape dismisses it |
| Windows OCR | built-in Windows OCR engine reads a rendered text image; engine is owned by one serialized worker thread |
| Recent files | deduplication, 8-item cap, demo exclusion, and missing-file removal covered by unit tests |
| Recent menu | opens from the menu bar and renders the empty-state correctly in the production UI |
| Password PDFs | encrypted fixture prompted, rejected a wrong password with retry, accepted the correct password, and rendered page 1 |
| Installer lifecycle | silent install cannot be automated on this host because SmartScreen blocks the unsigned NSIS package; association registration and uninstall commands verified from the generated installer script |
| Tab context actions | close-other and close-all store behavior covered by unit tests |
| Desktop runtime probe | Edge Dev 159 preview runtime: app created a visible window, then `msedgewebview2.exe`/`msedge.dll` aborted at `0x80000003`; confirms a host-wide Chromium breakpoint |
| Eraser | drew one annotation, erased it with the eraser tool; markup count returned from 1 to 0 |
| Browser interactions | pen drawing, palette, split pane, notebook, export dialog and Markdown export all pass |
| NSIS build | pass |
| Installer artifact | `PDFreader_0.1.0_x64-setup.exe`, 5,185,853 bytes |
| Installer SHA-256 | `F145F7842A351266B292639965063C8B98F8F718D90CD739C1B12B01A15802D3` |
| Portable SHA-256 | `2113CF7A2423CEDCA6C9D64F99B45F9360605763A4612CE8903916340B2D9BDD` |
| Portable SHA-256 | `3C596F14E690C53732775177CE1F7E98BF6B790A2D0B126992E613EBD1105E1E` |
| Text selection | 14 selectable text spans on the demo page; selection toolbar opens |
| Selection highlight | 6 highlight annotations created from a multi-line selection and rendered |
| Search | 2 results for “quiet”; the matched text span is highlighted on the page |
| PDF association launch queue | native pending-path queue implemented so early Explorer launches are delivered |
| Native PDF engine | bundled PDFium 8138 reports page counts and renders page PNGs; used by desktop open/thumbnail paths with PDF.js fallback |
| Session recovery | browser test changed page 1 → 2, reloaded, and restored page 2 with the same tab and no boot screen |
| Pane resizing | two 654 px panes resized to 719/588 px using keyboard on the focused separator (aria-valuenow 55) |
| Cross-document search | two open PDFs, “All open” scope, 2 matching results labeled `native-sample.pdf`, correct tab/page jump |
| Release verification | installer checksum, PDFium DLL/licenses, NSIS `.pdf` association register/unregister checks all pass |
| Settings components | native engine/optional component status panel compiles and is wired to `get_platform_info` |

The clean first-run screenshot is at `docs/assets/workspace.png`; the text-selection
workflow is shown in `docs/assets/highlighting.png`.

## Desktop runtime blocker

The release binary compiles and creates its native window, but WebView2 child
processes abort with `EXCEPTION_BREAKPOINT (0x80000003)` and Tauri reports
`failed to create webview: WebView2 error 0x8000FFFF: Catastrophic failure`.

This happens:

- with the installed WebView2 156 runtime;
- with a clean WebView2 user-data folder;
- with `--no-sandbox --disable-gpu --disable-gpu-sandbox
  --disable-features=AudioServiceSandbox`;
- with a locally installed fixed WebView2 155.0.4283.62 runtime;
- when launched from PowerShell, Explorer, and an out-of-job WMI process.

It is therefore a host runtime problem on this Windows 11 build, not a failure
of the React assets or the Rust document I/O. The browser production bundle,
native PDFium tests, and native compile/test paths are verified independently.
The compatibility path and documentation are included, but the host still
crashes with the fixed runtime, so this report does not claim a successful
desktop GUI session here.

## Installer status

The unsigned installer was built and checksummed. An automated silent install
was blocked by Windows SmartScreen because no Authenticode certificate is
available; no partial installation was created. Sign the installer before
public distribution. `.doc` and OCR require optional external components that
are not bundled.

## Remaining product gaps

- Native PDF `/Annots` objects and editable round-trip: annotations flatten into
  page content for sharing; drafts remain editable only in the local workspace
  for the original document.
- In-place editing and cryptographic signature preservation.
- PDFium native renderer and very large-file range streaming.
- Secure redaction.
- Installer signing and signed auto-update channel.
- Cross-platform packaging.

## Round 2 changes after the first installer

- Added a PDF.js text layer with selectable/copyable text and accessibility semantics.
- Added one-click text-selection highlighting with a floating action.
- Added search-result highlighting directly on the page text layer.
- Added a native pending-path queue so PDFs opened during app startup or through
  the single-instance handler are not lost.
- Bundled PDFium 8138 for native page counts and thumbnail rendering, with PDF.js fallback.
- Added versioned workspace session recovery for local PDFs and the demo.
- Added resizable split panes with accessible draggable dividers.
- Added cross-document search with source labels and cross-tab jumps.
- Added labeled page bookmarks with restart persistence.
- Expanded automated coverage to 26 frontend tests and 7 native tests.

