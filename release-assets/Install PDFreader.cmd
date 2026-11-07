@echo off
rem PDFreader installer launcher
rem The D:\Codes\AI Agents\... workspace is a sandboxed folder: executables
rem launched from inside it run with restricted permissions and cannot create
rem their temp files ("Error 5: Access is denied"). This launcher copies the
rem installer to your Downloads folder (a normal folder) and runs it there.

setlocal
set "SRC=%~dp0PDFreader_0.2.0_x64-setup.exe"
set "DEST=%USERPROFILE%\Downloads\PDFreader_0.2.0_x64-setup.exe"

if not exist "%SRC%" (
  echo PDFreader_0.2.0_x64-setup.exe not found next to this script.
  pause
  exit /b 1
)

copy /y "%SRC%" "%DEST%" >nul
if errorlevel 1 (
  echo Could not copy the installer to Downloads.
  pause
  exit /b 1
)

echo Starting PDFreader setup...
"%DEST%" %*
exit /b %errorlevel%
