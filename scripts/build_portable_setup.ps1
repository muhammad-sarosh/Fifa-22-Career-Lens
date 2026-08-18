$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$appExe = Join-Path $projectRoot "src-tauri\target\release\career-lens.exe"
$outputDir = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$outputExe = Join-Path $outputDir "Career Lens_$($package.version)_x64-setup.exe"
$scriptPath = Join-Path $PSScriptRoot "portable-installer.nsi"
$makeNsis = Join-Path $env:LOCALAPPDATA "tauri\NSIS\makensis.exe"

if (-not (Test-Path -LiteralPath $appExe)) {
    throw "Career Lens executable was not found at $appExe"
}

if (-not (Test-Path -LiteralPath $makeNsis)) {
    throw "NSIS compiler was not found at $makeNsis"
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

& $makeNsis "/DAPP_EXE=$appExe" "/DOUTPUT_EXE=$outputExe" $scriptPath
if ($LASTEXITCODE -ne 0) {
    throw "NSIS failed with exit code $LASTEXITCODE"
}

Write-Output "Created copy-only installer: $outputExe"
