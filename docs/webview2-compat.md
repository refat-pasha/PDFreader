# Optional WebView2 compatibility runtime

Some Windows 11 26H2 builds (notably build 26200) have a runtime regression in
WebView2 156.x where WebView2 processes abort with `STATUS_BREAKPOINT` and Tauri
reports `0x8000FFFF Catastrophic failure`. This is a host runtime issue, not an
application failure. Browser preview and the installer build are unaffected.

PDFreader detects a fixed runtime in either of these places before creating its
window:

1. `PDFREADER_WEBVIEW2_RUNTIME` environment variable pointing at a folder that
   contains `msedgewebview2.exe`.
2. `%LOCALAPPDATA%\PDFreader\WebView2Fixed\<version>\msedgewebview2.exe`.

If found, it sets `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` for that process. No
sandbox flag is disabled.

## Install a fixed runtime for local testing

Use Microsoft's WebView2 **Fixed Version** runtime package for x64. Extract the
CAB with Windows `expand` so the runtime layout stays intact:

```powershell
$dest = "$env:LOCALAPPDATA\PDFreader\WebView2Fixed"
New-Item -ItemType Directory -Force $dest | Out-Null
expand .\Microsoft.WebView2.FixedVersionRuntime.155.0.4283.62.x64.cab -F:* $dest
```

Restart PDFreader. On a machine where the installed Evergreen 156 runtime works,
leave this directory absent and use the normal runtime.

**Verification note:** this specific Windows 11 build 26200 machine still crashed
with WebView2 child processes at `0x80000003` even after pointing the app at the
fixed 155.0.4283.62 runtime, with a clean user-data folder, and with GPU/audio
sandbox flags. On 2026-11-05 the newest available **Edge Dev 159.0.4378.0**
preview runtime was also tested: the app created a visible `PDFreader` window,
then `msedgewebview2.exe` aborted in `msedge.dll` at `0x80000003` and the app
exited. This confirms a host-wide Chromium breakpoint, not a WebView2 version
problem. Treat the fixed-runtime path as a general compatibility option, not a
guaranteed repair for every affected machine. In that situation, use the browser
fallback described in `browser-fallback.md`.

The fixed runtime is not bundled by default because it adds roughly 300 MB and
must be kept updated separately. It is a compatibility option for affected
machines, not the default distribution.
