@echo off
rem Browser fallback for machines whose WebView2 runtime is currently broken.
rem The normal desktop app is the supported path; this launches the same
rem production UI in Edge's app window with local file open/save downloads.
setlocal
cd /d "%~dp0"
if not exist dist (
  echo Building PDFreader...
  call pnpm build || goto :error
)
start "PDFreader local server" /min cmd /c "pnpm preview --host 127.0.0.1 --port 4173 --strictPort"
timeout /t 3 /nobreak >nul
start "" msedge --app=http://127.0.0.1:4173 --window-size=1500,950
exit /b 0

:error
echo PDFreader could not be built. Run "pnpm install" and "pnpm build" first.
pause
exit /b 1
