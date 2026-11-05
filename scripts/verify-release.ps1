# Verifies a built PDFreader release without installing it.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $root "release\PDFreader_0.1.0_x64-setup.exe"
$portable = Join-Path $root "release\PDFreader-portable.exe"
$manifest = Join-Path $root "release\SHA256SUMS.txt"
$nsisScript = Join-Path $root "src-tauri\target\release\nsis\x64\installer.nsi"
$pdfium = Join-Path $root "src-tauri\target\release\resources\pdfium\bin\pdfium.dll"
$config = Join-Path $root "src-tauri\tauri.conf.json"
$failures = New-Object System.Collections.Generic.List[string]
$checks = New-Object System.Collections.Generic.List[object]

function Check($name, $condition, $detail) {
  $status = if ($condition) { "PASS" } else { "FAIL" }
  if (-not $condition) { $failures.Add($name) }
  $checks.Add([pscustomobject]@{ Check = $name; Status = $status; Detail = $detail })
}

Check "installer exists" (Test-Path $installer) $installer
Check "portable exists" (Test-Path $portable) $portable
Check "checksum manifest exists" (Test-Path $manifest) $manifest
Check "PDFium DLL present" (Test-Path $pdfium) $pdfium
Check "generated NSIS script present" (Test-Path $nsisScript) $nsisScript

if (Test-Path $installer) {
  $actual = (Get-FileHash $installer -Algorithm SHA256).Hash
  $expected = if (Test-Path $manifest) {
    $line = Get-Content $manifest | Where-Object { $_ -match "PDFreader_0.1.0_x64-setup.exe" } | Select-Object -First 1
    if ($line) { ($line -split '\s+')[0] } else { $null }
  } else { $null }
  Check "installer SHA-256 matches manifest" ($expected -and $actual -eq $expected) "$actual"
  $signature = Get-AuthenticodeSignature $installer
  Write-Host "Authenticode status: $($signature.Status) (unsigned local builds are expected to fail this informational check)"
}
if (Test-Path $pdfium) {
  Check "PDFium DLL has plausible size" ((Get-Item $pdfium).Length -gt 5000000) "$((Get-Item $pdfium).Length) bytes"
  Check "PDFium license bundled" (Test-Path (Join-Path (Split-Path $pdfium -Parent) "..\licenses\pdfium.txt")) "licenses/pdfium.txt"
}
if (Test-Path $nsisScript) {
  $script = Get-Content $nsisScript -Raw
  Check "installer associates .pdf" ($script -match 'APP_ASSOCIATE\s+"pdf"\s+"PDFdocument"') "APP_ASSOCIATE pdf PDFdocument"
  Check "installer removes association on uninstall" ($script -match 'APP_UNASSOCIATE\s+"pdf"\s+"PDFdocument"') "APP_UNASSOCIATE pdf PDFdocument"
  Check "installer bundles PDFium" ($script -match 'resources\\pdfium\\bin\\pdfium.dll') "resources/pdfium/bin/pdfium.dll"
}
if (Test-Path $config) {
  $json = Get-Content $config -Raw | ConvertFrom-Json
  $assoc = @($json.bundle.fileAssociations) | Where-Object { $_.ext -contains "pdf" } | Select-Object -First 1
  Check "Tauri config declares PDF association" ($null -ne $assoc) "bundle.fileAssociations .pdf"
}

$checks | Format-Table -AutoSize
if ($failures.Count -gt 0) {
  Write-Host "Release verification FAILED: $($failures -join ', ')"
  exit 1
}
Write-Host "Release verification passed (signature warnings are expected for unsigned local builds)."
