# Builds Alek Weather as an Android APK.
#
# The web app is the source of truth: this runs the normal Vite build, copies
# dist/ into the APK's assets, and lets Gradle package it. MainActivity serves
# those assets over https://appassets.androidplatform.net/ via
# WebViewAssetLoader, so the base path stays "/" and the bundle is byte-for-byte
# the same one that ships to GitHub Pages.
#
# Prereqs (already installed under ~/android-tools): JDK 17, Gradle 8.7,
# Android SDK platform 34 + build-tools 34.
#
#   powershell -ExecutionPolicy Bypass -File android\build-apk.ps1            # debug
#   powershell -ExecutionPolicy Bypass -File android\build-apk.ps1 -Release   # signed
#
# -Release needs android\keystore.properties (gitignored) pointing at the
# keystore outside the repo. Anything published publicly should be -Release:
# debug builds set android:debuggable="true".

param([switch]$Release)

$ErrorActionPreference = 'Stop'

$tools   = Join-Path $env:USERPROFILE 'android-tools'
$root    = Split-Path -Parent $PSScriptRoot          # the WeatherApp repo
$android = $PSScriptRoot
$assets  = Join-Path $android 'app\src\main\assets'

# Resolved by glob rather than pinned to an exact build: the JDK 17 directory
# name carries its patch version (jdk-17.0.20+8), so hardcoding one means the
# script breaks the next time the toolchain is refreshed. Any 17.x will do:
# AGP 8.2.2 requires 17 and does not yet run on 21+.
#
# Keep this file pure ASCII. Windows PowerShell 5.1 reads a .ps1 with no BOM as
# ANSI, so a stray em-dash in a comment becomes mojibake and takes the parser
# down with it - the error lands on an unrelated line, which is a genuinely
# baffling ten minutes if you have not seen it before.
$jdk = Get-ChildItem (Join-Path $tools 'jdk') -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue |
       Sort-Object Name | Select-Object -Last 1
if (-not $jdk) { throw "No JDK 17 under $tools\jdk - see android/README.md for the toolchain setup." }
$env:JAVA_HOME = $jdk.FullName
# Gradle finds the SDK through this; the alternative is a local.properties that
# would have to be gitignored and recreated on every machine.
$env:ANDROID_HOME = Join-Path $tools 'sdk'
$gradle           = Join-Path $tools 'gradle-8.7\bin\gradle.bat'

Write-Host '==> Building web app (vite build)' -ForegroundColor Cyan
Push-Location $root
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed ($LASTEXITCODE)" }
} finally { Pop-Location }

Write-Host '==> Copying dist/ into APK assets' -ForegroundColor Cyan
# Wipe first: stale hashed bundles left behind would bloat the APK and the
# service worker's precache manifest would not reference them anyway.
if (Test-Path $assets) { Remove-Item -Recurse -Force $assets }
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item -Recurse -Force (Join-Path $root 'dist\*') $assets

$variant = if ($Release) { 'Release' } else { 'Debug' }
$flavour = $variant.ToLower()

if ($Release -and -not (Test-Path (Join-Path $android 'keystore.properties'))) {
    throw 'keystore.properties missing; -Release would produce an unsigned APK.'
}

Write-Host "==> Assembling APK (gradle, $flavour)" -ForegroundColor Cyan
Push-Location $android
try {
    & $gradle --no-daemon ":app:assemble$variant"
    if ($LASTEXITCODE -ne 0) { throw "gradle assemble$variant failed ($LASTEXITCODE)" }
} finally { Pop-Location }

$apk = Join-Path $android "app\build\outputs\apk\$flavour\app-$flavour.apk"
$out = if ($Release) { Join-Path $root 'AlekWeather.apk' }
       else { Join-Path $root 'AlekWeather-debug.apk' }
Copy-Item -Force $apk $out

$size = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host ''
Write-Host "==> Done: $out ($size MB)" -ForegroundColor Green
