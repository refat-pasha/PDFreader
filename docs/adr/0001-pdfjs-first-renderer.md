# ADR 0001: PDF.js as the first renderer

- **Status:** Accepted for v0.1; partially superseded by ADR 0002 (native PDFium backend added for page counts and thumbnails)
- **Date:** 2026-11-05
- **Context:** The approved plan started with native PDFium and permitted PDF.js as the fallback if a Phase 0 proof did not meet the first release milestone. The greenfield workspace had no Rust toolchain at kickoff, and a working reader, annotation layer, persistence, and export pipeline were required before native packaging.
- **Decision:** Use Apache-2.0 PDF.js through `pdfjs-dist` for page rendering and text extraction. Keep page/annotation geometry independent of PDF.js and expose page rendering through `src/features/viewer/pdfjs.ts`.
- **Consequences:**
  - Fast path to a complete, testable workspace with no PDFium binary supply-chain or FFI integration risk.
  - PDF.js copies document bytes into its worker; large-file memory is higher than a range-based native renderer.
  - Text extraction, search, and paint fidelity depend on PDF.js behavior.
  - The next engine milestone can replace the renderer without touching tab state, notes, annotations, or export geometry.
- **Follow-up:** benchmark PDFium against the representative corpus and add range-based reading plus native image output when the application moves beyond v0.1.
