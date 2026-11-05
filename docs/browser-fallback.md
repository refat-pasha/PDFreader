# Run the browser preview

This fallback is useful when the Windows WebView2 runtime is broken (for example
the Windows 11 build 26200 regression described in `webview2-compat.md`). It
uses the same production web bundle as the desktop app, but runs in your normal
browser. Browser file open and download work; native save dialogs, Windows
association, and the LibreOffice/Tesseract desktop integrations are unavailable.

```powershell
pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

Open <http://127.0.0.1:4173>.
