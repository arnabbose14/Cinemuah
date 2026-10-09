# Builds the Windows installer: app build -> unpacked app -> exe icon/version -> Inno Setup.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version

Write-Host "1/4 Building the app..."
npm run build
if ($LASTEXITCODE) { throw 'build failed' }

Write-Host "2/4 Packing the unpacked app..."
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win --dir
if ($LASTEXITCODE) { throw 'electron-builder failed' }

Write-Host "3/4 Setting the exe icon and version info..."
$exe = Join-Path $root 'release\win-unpacked\Cinemuah.exe'
$rcedit = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -Recurse -Filter rcedit-x64.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $rcedit) { throw 'rcedit-x64.exe not found (run electron-builder once so it downloads its tools)' }
& $rcedit.FullName $exe --set-icon (Join-Path $root 'public\cinemuah.ico') `
  --set-file-version "$version.0" --set-product-version $version `
  --set-version-string ProductName Cinemuah --set-version-string FileDescription Cinemuah `
  --set-version-string CompanyName Cinemuah --set-version-string LegalCopyright 'Cinemuah' `
  --set-version-string OriginalFilename Cinemuah.exe
if ($LASTEXITCODE) { throw 'rcedit failed' }

Write-Host "4/4 Compiling the installer with Inno Setup..."
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) not found' }
& $iscc "/DAppVersion=$version" (Join-Path $root 'installer\cinemuah.iss')
if ($LASTEXITCODE) { throw 'Inno Setup failed' }

Write-Host "Done: release\installer\Cinemuah-Setup-$version.exe"
