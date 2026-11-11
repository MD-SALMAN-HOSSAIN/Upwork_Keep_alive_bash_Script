#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not $env:DASHBOARD_URL) { $env:DASHBOARD_URL = 'https://www.upwork.com/nx/find-work/' }
if (-not $env:CDP_URL) { $env:CDP_URL = 'http://127.0.0.1:9222' }
if (-not $env:MIN_MINUTES) { $env:MIN_MINUTES = '2' }
if (-not $env:MAX_MINUTES) { $env:MAX_MINUTES = '5' }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js 18+ is required: https://nodejs.org/'
  exit 1
}

$modulePath = Join-Path $PSScriptRoot 'node_modules\puppeteer-core'
if (-not (Test-Path -LiteralPath $modulePath)) {
  Write-Host '[run.ps1] Installing dependencies (first run)...'
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

try {
  $null = Invoke-RestMethod -Uri "$($env:CDP_URL)/json/version" -TimeoutSec 3
} catch {
  Write-Host '[run.ps1] Chrome is not reachable on the remote-debugging port.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Start Chrome with remote debugging first:'
  Write-Host '  .\start-chrome.ps1'
  Write-Host ''
  Write-Host 'Then log in to the dashboard in the new Chrome window and run .\run.ps1 again.'
  Write-Host 'Chrome 136+ requires a non-default --user-data-dir; start-chrome.ps1 handles that.'
  exit 1
}

Write-Host "[run.ps1] Starting keep-alive for $($env:DASHBOARD_URL) (every $($env:MIN_MINUTES)-$($env:MAX_MINUTES) min)"
node keepalive.js
exit $LASTEXITCODE
