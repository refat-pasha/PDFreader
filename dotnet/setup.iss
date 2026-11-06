; PDFreader 0.2.0 installer (Inno Setup 6)
; Installs the self-contained .NET WPF build for the current user,
; registers a .pdf viewer entry, and offers desktop/start-menu shortcuts.

#define MyAppName "PDFreader"
#define MyAppVersion "0.2.0"
#define MyAppPublisher "PDFreader"
#define MyAppExeName "PDFreader.exe"

[Setup]
AppId={{8E1B4D5A-77C2-4B62-9A34-PDFR0200ALT}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
; Per-user install: no admin required, writes under LocalAppData
PrivilegesRequired=lowest
OutputBaseFilename=PDFreader_0.2.0_x64-setup
OutputDir=installer
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=PDFreader.App\Assets\app.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "pdfassoc"; Description: "Register PDFreader as a PDF viewer (you still choose the default app in Windows Settings)"; GroupDescription: "File association:"

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; ProgID for the viewer; HKCU so no elevation is needed. We never touch UserChoice.
Root: HKCU; Subkey: "Software\Classes\PDFreader.pdf"; ValueType: string; ValueData: "PDF document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\PDFreader.pdf\DefaultIcon"; ValueType: string; ValueData: "{app}\{#MyAppExeName},0"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\PDFreader.pdf\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: string; ValueName: "PDFreader.pdf"; ValueData: ""; Flags: uninsdeletevalue; Tasks: pdfassoc
Root: HKCU; Subkey: "Software\Classes\Applications\PDFreader.exe\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; nothing extra; registry keys are removed via Flags above
