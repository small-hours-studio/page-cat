# Builds the zip you upload to the Chrome Web Store: dist/page-cat-<version>.zip
# Run from the page-cat folder:  powershell -ExecutionPolicy Bypass -File tools/package.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null

# Only what the extension needs at runtime.
$files = @('manifest.json', 'background.js', 'shared.js', 'popup.html', 'popup.css', 'popup.js')
foreach ($f in $files) { Copy-Item (Join-Path $root $f) $stage }
New-Item -ItemType Directory -Force (Join-Path $stage 'content') | Out-Null
Copy-Item (Join-Path $root 'content\cat.js') (Join-Path $stage 'content')
New-Item -ItemType Directory -Force (Join-Path $stage 'icons') | Out-Null
foreach ($px in 16, 32, 48, 128) { Copy-Item (Join-Path $root "icons\icon$px.png") (Join-Path $stage 'icons') }

# The order site's status page shows customers their cat with the same engine.
Copy-Item (Join-Path $root 'content\cat.js') (Join-Path (Split-Path -Parent $root) 'docs\js\cat.js')

$zip = Join-Path $dist "page-cat-$version.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item -Recurse -Force $stage
Write-Output "Built $zip"
