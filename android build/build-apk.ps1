# Builds the Cinemuah Android APK end to end.
#   1. bundles the shared React UI for the phone   2. syncs it into the Android project   3. builds the APK
# Usage:  .\build-apk.ps1            signed release APK  -> Cinemuah.apk
#         .\build-apk.ps1 -Debug     debuggable APK (used by the test harness) -> Cinemuah-debug.apk
param([switch]$Debug)
$ErrorActionPreference = 'Stop'
$proj  = $PSScriptRoot
$tools = "$env:USERPROFILE\android-tools"
$env:JAVA_HOME    = "$tools\jdk17"
$env:ANDROID_HOME = "$tools\sdk"
$env:ANDROID_SDK_ROOT = "$tools\sdk"

Set-Location $proj
npx vite build --config vite.config.android.ts
npx cap sync android

Set-Location "$proj\android"
$task = if ($Debug) { 'assembleDebug' } else { 'assembleRelease' }
& .\gradlew.bat $task --no-daemon --console=plain
if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

$variant = if ($Debug) { 'debug' } else { 'release' }
$apk = Get-ChildItem "$proj\android\app\build\outputs\apk\$variant\*.apk" | Select-Object -First 1
$out = if ($Debug) { "$proj\Cinemuah-debug.apk" } else { "$proj\Cinemuah.apk" }
Copy-Item $apk.FullName $out -Force
"APK: $out ($([math]::Round((Get-Item $out).Length/1MB,1)) MB)"
