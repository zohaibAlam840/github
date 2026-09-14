<#
  Stops the dashboard and the SMS worker.

  The launcher already cleans up when its window closes normally. This is
  for the other cases - End Task, a power cut, a crash - where the child
  processes outlive it and keep holding ports 3000 and 3900, which then
  looks like "the app will not start".

  Works from the recorded PIDs first, and falls back to whoever is holding
  the ports, because a stale PID file is exactly the situation this is for.
#>

$ErrorActionPreference = "SilentlyContinue"
$Root    = Split-Path $PSScriptRoot -Parent
$PidFile = Join-Path $Root ".run\pids.json"

$stopped = 0

function Stop-Tree($processId, $label) {
  if (-not $processId) { return $false }
  if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { return $false }
  & taskkill /PID $processId /T /F 2>$null | Out-Null
  Write-Host "  Stopped $label (PID $processId)" -ForegroundColor Green
  return $true
}

Write-Host ""
Write-Host "  Stopping i2i..." -ForegroundColor Cyan
Write-Host ""

if (Test-Path $PidFile) {
  $recorded = Get-Content $PidFile -Raw | ConvertFrom-Json
  if (Stop-Tree $recorded.worker    "SMS worker") { $stopped++ }
  if (Stop-Tree $recorded.dashboard "dashboard")  { $stopped++ }
  Remove-Item $PidFile -Force
}

# Whatever is still holding the ports, recorded or not.
foreach ($port in 3900, 3000, 3001, 3002) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($owner in $owners) {
    if (Stop-Tree $owner "the process on port $port") { $stopped++ }
  }
}

Write-Host ""
if ($stopped -eq 0) {
  Write-Host "  Nothing was running." -ForegroundColor Gray
} else {
  Write-Host "  Done. Ports are free." -ForegroundColor Green
}
Write-Host ""
Start-Sleep -Seconds 2
