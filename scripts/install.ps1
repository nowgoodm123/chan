# chan_code installer for Windows (PowerShell 5.1+)
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Prefix "$env:USERPROFILE\.npm-global"

param(
  [string]$Prefix = '',
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host 'chan_code installer' -ForegroundColor Cyan
Write-Host "source: $root"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js was not found. Install Node.js 18.17 or newer from https://nodejs.org and re-run this script.'
}

$nodeVersion = (node --version).TrimStart('v')
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 18) {
  Write-Error "Node.js 18.17+ is required (found $nodeVersion)."
}
Write-Host "node:   v$nodeVersion"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error 'npm was not found. Reinstall Node.js with npm included.'
}

Push-Location $root
try {
  if ($Prefix) {
    New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
    Write-Host "installing to npm prefix: $Prefix"
    & npm install -g . --prefix $Prefix
  } else {
    & npm install -g .
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Global install failed. This is usually a permissions issue.'
    Write-Host 'Try one of:' -ForegroundColor Yellow
    Write-Host '  npm install -g . --prefix "$env:USERPROFILE\.npm-global"'
    Write-Host '  npm link'
    Write-Host '  node bin\chan.js --help   (run without installing)'
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

if (-not $SkipVerify) {
  try {
    & chan --version
  } catch {
    Write-Warning '"chan" is not on PATH yet. Add your npm global bin directory to PATH, or run: node bin\chan.js --help'
  }
}

Write-Host ''
Write-Host 'installed. next steps:' -ForegroundColor Green
Write-Host '  chan init --provider deepseek'
Write-Host '  $env:DEEPSEEK_API_KEY = "sk-..."'
Write-Host '  chan                    # terminal chat'
Write-Host '  chan serve --open        # browser UI with image/file upload'
Write-Host ''
Write-Host 'docs: docs\GETTING_STARTED.md'
