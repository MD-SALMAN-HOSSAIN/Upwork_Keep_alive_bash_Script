#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$chromeCandidates = @()
if ($env:ProgramFiles) {
  $chromeCandidates += Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
}
if (${env:ProgramFiles(x86)}) {
  $chromeCandidates += Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'
}
if ($env:LOCALAPPDATA) {
  $chromeCandidates += Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'
}

$chrome = $null
foreach ($candidate in $chromeCandidates) {
  if (Test-Path -LiteralPath $candidate) {
    $chrome = $candidate
    break
  }
}

if (-not $chrome) {
  Write-Error 'Google Chrome was not found. Install Chrome or start it manually with remote debugging.'
  exit 1
}

$port = if ($env:CDP_PORT) { $env:CDP_PORT } else { '9222' }
$profile = if ($env:CHROME_DEBUG_PROFILE) {
  $env:CHROME_DEBUG_PROFILE
} else {
  Join-Path $env:USERPROFILE '.chrome-debug-profile'
}
$url = if ($env:DASHBOARD_URL) {
  $env:DASHBOARD_URL
} else {
  'https://www.upwork.com/nx/find-work/'
}

try {
  $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2
  Write-Host "Chrome remote debugging is already running on port $port."
  exit 0
} catch {
  # Not running yet; continue.
}

Write-Host "Starting Chrome with remote debugging on port $port..."
Write-Host "Profile: $profile"

$arguments = "--remote-debugging-port=$port --remote-debugging-address=127.0.0.1 --user-data-dir=`"$profile`" --no-first-run --no-default-browser-check `"$url`""
Start-Process -FilePath $chrome -ArgumentList $arguments | Out-Null

$ready = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2
    $ready = $true
    break
  } catch {
    # Keep waiting.
  }
}

if (-not $ready) {
  Write-Warning "Chrome did not open the debugging port $port."
  Write-Warning 'If a Chrome window is already using this debug profile, close that window and run this script again.'
  exit 1
}

Write-Host ''
Write-Host "Chrome is ready on port $port."
Write-Host 'Log in to the dashboard in the new Chrome window if needed.'
