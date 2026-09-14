<#
  i2i Control Management System - one-click launcher.

  The office PC runs TWO processes and needs both: the dashboard (Next.js,
  the screens people use) and the SMS worker (owns the modem on its COM
  port). Asking an operator to open two terminals, remember two commands and
  keep both windows alive is how a system gets reported as "broken" on a
  Monday morning. This script is the single front door.

  It starts both, waits until each one actually answers, then prints the one
  address to use. If something does not come up it says which half and why,
  instead of opening a browser onto a connection error.

  Close this window to stop both. "Stop i2i.cmd" does the same thing.
#>

param([switch]$Rebuild)

$ErrorActionPreference = "Stop"
$Root      = $PSScriptRoot
$AppDir    = Join-Path $Root "i2ie-webapp\my-app"
$WorkerDir = Join-Path $Root "sms-worker"
$RunDir    = Join-Path $Root ".run"
$PidFile   = Join-Path $RunDir "pids.json"
$LogDir    = Join-Path $RunDir "logs"

# The worker binds this or exits; it never drifts to another port. Keep in
# step with CONTROL_PORT in sms-worker/src/config.ts.
$WorkerPort    = 3900
# Preferred dashboard port. Pinned so the office can bookmark one address.
$PreferredPort = 3000

New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null

function Write-Step($text)  { Write-Host "  $text" -ForegroundColor Gray }
function Write-Ok($text)    { Write-Host "  [ok] $text" -ForegroundColor Green }
function Write-Note($text)  { Write-Host "  [!]  $text" -ForegroundColor Yellow }
function Write-Fail($text)  { Write-Host "  [x]  $text" -ForegroundColor Red }

function Test-PortBusy($port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $port); $c.Close(); return $true }
  catch { return $false }
}

# Which process is listening on a port. Get-NetTCPConnection is the clean
# way; netstat is the fallback for a machine where that cmdlet is missing or
# blocked, because this is now load-bearing for startup.
function Get-PortOwner($port) {
  $ids = @()
  try {
    $ids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
           Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    $ids = & netstat -ano -p TCP 2>$null |
      Select-String -Pattern "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$" |
      ForEach-Object { [int]$_.Matches[0].Groups[1].Value } |
      Select-Object -Unique
  }
  return @($ids | Where-Object { $_ -and $_ -gt 4 -and $_ -ne $PID })
}

<#
  Takes a port back.

  The worker binds CONTROL_PORT or EXITS - by design, so its address can
  never drift and the dashboard's saved worker URL can never go stale. The
  cost of that design is that anything else squatting on 3900 stops the
  system dead, and the usual squatter is our own worker left running from a
  terminal or a previous session that was killed without cleanup.

  Stop-Previous cannot help there: it only knows the PIDs it recorded. So
  before binding, ask the OS who actually holds the port and stop them.

  The occupant is always named before it is killed. On a machine dedicated
  to this system that will be a stale node.exe every time, but if it is ever
  something else the operator sees what was stopped rather than wondering.
#>
function Clear-Port($port) {
  if (-not (Test-PortBusy $port)) { return $true }

  foreach ($owner in (Get-PortOwner $port)) {
    $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { "unknown" }
    Write-Note "Port $port was held by $name (PID $owner) - stopping it."
    # /T because npm and cmd wrappers spawn the node process that actually
    # holds the socket; killing only the parent leaves the port bound.
    & taskkill /PID $owner /T /F 2>$null | Out-Null
  }

  # Sockets do not always release the instant the process dies.
  for ($i = 0; $i -lt 10; $i++) {
    if (-not (Test-PortBusy $port)) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

# Waits for an HTTP endpoint to answer. Any response at all counts: a 404 or
# a 500 still proves the server is listening, which is what we are asking.
function Wait-ForHttp($url, $timeoutSeconds, $proc) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null
      return $true
    } catch {
      if ($_.Exception.Response) { return $true }
    }
    # A process that has already exited is never going to answer. Without
    # this the launcher sits out the full timeout staring at a dead pipe,
    # which reads as a hang rather than as the failure it is.
    if ($proc -and $proc.HasExited) { return $false }
    Start-Sleep -Milliseconds 700
  }
  return $false
}

function Stop-Previous {
  if (-not (Test-Path $PidFile)) { return }
  try { $old = Get-Content $PidFile -Raw | ConvertFrom-Json } catch { return }
  foreach ($p in @($old.worker, $old.dashboard)) {
    if (-not $p) { continue }
    try {
      Get-Process -Id $p -ErrorAction Stop | Out-Null
      Write-Step "Stopping a previous run (PID $p)..."
      & taskkill /PID $p /T /F 2>$null | Out-Null
    } catch { }
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Clear-Host
Write-Host ""
Write-Host "  i2i Control Management System" -ForegroundColor Cyan
Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# --- Prerequisites -----------------------------------------------------
$nodeVersion = $null
try { $nodeVersion = (& node --version) } catch { }
if (-not $nodeVersion) {
  Write-Fail "Node.js is not installed on this PC."
  Write-Host ""
  Write-Host "  Install the LTS build from https://nodejs.org and run this again."
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}
Write-Ok "Node.js $nodeVersion"

Stop-Previous

# --- Dependencies ------------------------------------------------------
if (-not (Test-Path (Join-Path $WorkerDir "node_modules"))) {
  Write-Step "First run: installing worker components (a few minutes)..."
  Push-Location $WorkerDir; & npm install --no-fund --no-audit; Pop-Location
}
if (-not (Test-Path (Join-Path $AppDir "node_modules"))) {
  Write-Step "First run: installing dashboard components (a few minutes)..."
  Push-Location $AppDir; & npm install --no-fund --no-audit; Pop-Location
}

# --- Dashboard build ---------------------------------------------------
# next start refuses to run without one, and the error it prints is not
# something an operator should have to interpret.
$buildId = Join-Path $AppDir ".next\BUILD_ID"
if ($Rebuild) {
  Remove-Item (Join-Path $AppDir ".next") -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path $buildId)) {
  Write-Step "Preparing the dashboard (one-off, about a minute)..."
  Push-Location $AppDir
  & npm run build
  $buildOk = ($LASTEXITCODE -eq 0)
  Pop-Location
  if (-not $buildOk) {
    Write-Fail "The dashboard could not be prepared. Nothing was started."
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
  }
}
Write-Ok "Dashboard ready"

# --- Claim the worker port --------------------------------------------
# Not optional: the worker cannot use any other port, so if this one is not
# free there is nothing to fall back to.
if (-not (Clear-Port $WorkerPort)) {
  Write-Fail "Port $WorkerPort is held by something that will not stop, so the SMS worker cannot start."
  Write-Host "       Restart the PC, or run: taskkill /PID <pid> /T /F" -ForegroundColor DarkGray
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}

# --- Pick the dashboard port ------------------------------------------
# Reclaim 3000 the same way. A stale dashboard from a previous run is by far
# the likeliest occupant, and moving to 3001 instead would quietly change the
# address the whole office has bookmarked. Only if the port genuinely will
# not come free do we move, and then we say so.
$DashPort = $PreferredPort
if (-not (Clear-Port $PreferredPort)) {
  $DashPort = $null
  foreach ($p in ($PreferredPort + 1)..($PreferredPort + 10)) {
    if (-not (Test-PortBusy $p)) { $DashPort = $p; break }
  }
  if (-not $DashPort) {
    Write-Fail "Ports $PreferredPort to $($PreferredPort + 10) are all in use. Nothing was started."
    Read-Host "  Press Enter to close"
    exit 1
  }
  Write-Note "Port $PreferredPort could not be freed - using $DashPort instead."
}

# --- Start the worker --------------------------------------------------
Write-Step "Starting the SMS worker..."
$workerLog = Join-Path $LogDir "worker.log"
$workerProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "npm run worker > ""$workerLog"" 2>&1" `
  -WorkingDirectory $WorkerDir -WindowStyle Hidden -PassThru

# --- Start the dashboard ----------------------------------------------
# -H 0.0.0.0 so other office PCs on the LAN can reach it, not just this one.
Write-Step "Starting the dashboard..."
$dashLog = Join-Path $LogDir "dashboard.log"
$dashProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "npx next start -H 0.0.0.0 -p $DashPort > ""$dashLog"" 2>&1" `
  -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru

@{ worker = $workerProc.Id; dashboard = $dashProc.Id; port = $DashPort } |
  ConvertTo-Json | Set-Content $PidFile -Encoding utf8

# --- Wait for both to actually answer ---------------------------------
if (Wait-ForHttp "http://127.0.0.1:$WorkerPort/health" 40 $workerProc) {
  Write-Ok "SMS worker listening on port $WorkerPort"
} else {
  # Deliberately not fatal. The dashboard is still worth having: it shows
  # the valve history and says plainly that the sender is offline, which
  # beats no screen at all while someone re-seats the modem.
  Write-Note "SMS worker did not start. No SMS can be sent until it does."
  Write-Host "       Details: $workerLog" -ForegroundColor DarkGray
}

if (-not (Wait-ForHttp "http://127.0.0.1:$DashPort/" 90 $dashProc)) {
  Write-Fail "The dashboard did not start."
  Write-Host "       Details: $dashLog" -ForegroundColor DarkGray
  & taskkill /PID $workerProc.Id /T /F 2>$null | Out-Null
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}
Write-Ok "Dashboard listening on port $DashPort"

# --- The address ------------------------------------------------------
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Sort-Object -Property SkipAsSource, InterfaceMetric |
  Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
Write-Host "   READY" -ForegroundColor Green
Write-Host ""
Write-Host "   On this PC:        http://localhost:$DashPort" -ForegroundColor White
if ($lanIp) {
  Write-Host "   On the office LAN: http://${lanIp}:$DashPort" -ForegroundColor White
}
Write-Host "   SMS worker:        http://localhost:$WorkerPort" -ForegroundColor DarkGray
Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Keep this window open. Closing it stops the system." -ForegroundColor Yellow
Write-Host ""

Start-Process "http://localhost:$DashPort"

# --- Supervise --------------------------------------------------------
# Sit here so the window stays meaningful and closing it takes both
# children down with it.
try {
  while ($true) {
    Start-Sleep -Seconds 5
    if ($dashProc.HasExited) {
      Write-Fail "The dashboard stopped unexpectedly. See $dashLog"
      break
    }
    if ($workerProc -and $workerProc.HasExited) {
      Write-Note "The SMS worker stopped. Restart to send SMS again. See $workerLog"
      $workerProc = $null
    }
  }
} finally {
  Write-Host ""
  Write-Step "Shutting down..."
  foreach ($p in @($workerProc, $dashProc)) {
    if ($p -and -not $p.HasExited) {
      # npm spawns children; kill the tree, not just the launcher.
      & taskkill /PID $p.Id /T /F 2>$null | Out-Null
    }
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
