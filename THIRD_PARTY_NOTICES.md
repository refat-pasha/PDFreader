# Third-party notices

PDFreader v0.1.0 includes or links the following open-source components. This is
a practical summary, not a replacement for the full license texts distributed
with each dependency. Generate an SBOM and complete notices before a public
binary release.

| Component | Version policy | License |
|---|---|---|
| Tauri | 2.x | MIT OR Apache-2.0 |
| React / React DOM | 19.x | MIT |
| PDF.js (`pdfjs-dist`) | 5.7.x | Apache-2.0 |
| PDFium native runtime | 8138 (Chromium) | BSD-style; full third-party licenses included under `src-tauri/resources/pdfium/licenses/` |
| `pdfium-render` | 0.9.5 | MIT OR Apache-2.0 |
| Rust `image` | 0.25.x | MIT OR Apache-2.0 |
| `pdf-lib` | 1.17.x | MIT |
| `docx` | 9.x | MIT |
| JSZip | 3.x | MIT OR GPL-3.0 (used under MIT) |
| Zustand | 5.x | MIT |
| Lucide icons | 0.468.x | ISC |
| Vite / Vitest | 6.x / 3.x | MIT |
| `tauri-plugin-dialog` | 2.x | MIT OR Apache-2.0 |
| `tauri-plugin-single-instance` | 2.x | MIT OR Apache-2.0 |
| `tauri-plugin-window-state` | 2.x | MIT OR Apache-2.0 |
| Rust `windows-sys` | 0.59 | MIT OR Apache-2.0 |
| Rust `windows` / `windows-future` | 0.61 / 0.2 | MIT OR Apache-2.0 |
| WebView2 Evergreen Runtime | system-provided | Microsoft distribution terms |
| LibreOffice (optional) | user-installed | MPL-2.0 and compatible licenses |
| Tesseract OCR (optional) | user-installed | Apache-2.0 |

Optional external components are not bundled by v0.1.0. Their licenses and
installation terms apply when the user installs them.

The PDFreader application code is currently unlicensed for redistribution; add a
project license before publishing source or binaries.
