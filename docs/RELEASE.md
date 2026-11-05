# Release 0.1 checklist

## Build inputs

- [ ] Node.js LTS and pnpm 11
- [ ] Rust stable MSVC and VS Build Tools C++ workload
- [ ] Reinstall dependencies with `pnpm install --frozen-lockfile`
- [ ] Run `pnpm verify`
- [ ] Run native `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] Run `pnpm tauri build`

## Artifacts

- [ ] NSIS installer exists under `src-tauri/target/release/bundle/nsis`
- [ ] Run `powershell -File scripts/verify-release.ps1`; all structural checks pass
- [ ] Installer SHA-256 matches `release/SHA256SUMS.txt`
- [ ] Generated `installer.nsi` contains `APP_ASSOCIATE "pdf" "PDFdocument"`
- [ ] `resources/pdfium/bin/pdfium.dll` and licenses are bundled
- [ ] Third-party notices bundled or linked
- [ ] Version and product name verified in Windows Apps & Features
- [ ] Sign the installer with Authenticode before public distribution
- [ ] Install, launch, open PDF, export, uninstall on a clean Windows 10 VM
- [ ] Repeat on clean Windows 11 VM

## Known gating issues for public release

- No Authenticode certificate is configured, so the unsigned installer may trigger SmartScreen.
- No signed auto-update manifest is configured.
- OCR and LibreOffice are optional external components, not bundled.
- The PDF renderer is PDF.js, not PDFium.
- In-place editing and cryptographic signature preservation are not implemented.
