# keep-dev-alive.ps1 — self-healing watchdog for the Aexyl CRM Next.js dev server.
# Restarts `next dev` whenever it dies, pinned to a FIXED port so the registered
# preview URL stays valid across crashes. Also re-checks Docker/Postgres before
# each (re)start. Procedure documented in .freebuff/run.md.
#
# Stop with:  taskkill /PID (watchdog.pid) /T /F   (kills watchdog + dev child)
param(
  [int]$Port = 3000,
  [int]$PortWaitSec = 60,
  [int]$DockerWaitSec = 90
)
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
$fb = Join-Path $root '.freebuff'
if (-not (Test-Path $fb)) { New-Item -ItemType Directory -Path $fb | Out-Null }
$watchdogLog = Join-Path $fb 'watchdog.log'

function WLog([string]$msg) {
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $PID, $msg
  Add-Content -Path $watchdogLog -Value $line -Encoding UTF8
}

Set-Content -Path (Join-Path $fb 'watchdog.pid') -Value $PID -Encoding ASCII
WLog "watchdog START (port=$Port)"

function Test-Listening([int]$p) {
  return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-ListenerPid([int]$p) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess } else { return 0 }
}

function Test-Healthy([int]$p) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/api/health" -f $p) -TimeoutSec 3 -ErrorAction Stop
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Stop-Tree([int]$procId) {
  if ($procId -gt 0) { taskkill /PID $procId /T /F 2>&1 | Out-Null }
}

function Ensure-Db {
  $engineOk = $false
  docker info *>$null
  if ($LASTEXITCODE -eq 0) { $engineOk = $true }
  if (-not $engineOk) {
    WLog 'docker engine down'
    if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
      $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
      if (Test-Path $dd) { Start-Process $dd | Out-Null; WLog 'launched Docker Desktop' }
    }
    $deadline = (Get-Date).AddSeconds($DockerWaitSec)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 5
      docker info *>$null
      if ($LASTEXITCODE -eq 0) { $engineOk = $true; break }
    }
  }
  if (-not $engineOk) { WLog 'docker engine NOT ready (starting dev anyway)'; return }

  $running = docker inspect -f '{{.State.Running}}' aexyl-postgres 2>$null
  if ("$running" -ne 'true') {
    docker start aexyl-postgres *>$null | Out-Null
    WLog 'started aexyl-postgres'
  }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    docker exec aexyl-postgres pg_isready -U postgres -d aexyl *>$null
    if ($LASTEXITCODE -eq 0) { WLog 'postgres ready'; return }
    Start-Sleep -Seconds 2
  }
  WLog 'postgres NOT ready after 30s (starting dev anyway)'
}

function Start-Dev {
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outLog = Join-Path $fb ("dev-{0}.log" -f $ts)
  $errLog = Join-Path $fb ("dev-{0}.err.log" -f $ts)
  $p = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--', '-p', "$Port") `
    -WorkingDirectory $root `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
    -WindowStyle Hidden -PassThru
  WLog ("dev START pid={0} log=dev-{1}.log" -f $p.Id, $ts)
  # keep only the newest 10 dev logs so .freebuff doesn't grow unbounded
  Get-ChildItem -Path $fb -Filter 'dev-*.log' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 |
    Remove-Item -Force -ErrorAction SilentlyContinue
  return $p
}

$failStreak = 0
while ($true) {
  try {
    # Port already bound: adopt it if healthy, otherwise clear the squatter.
    if (Test-Listening $Port) {
      if (Test-Healthy $Port) {
        WLog "port $Port already serving; waiting"
        Start-Sleep -Seconds 10
        continue
      }
      $opid = Get-ListenerPid $Port
      WLog "port $Port held by unhealthy pid=$opid -> killing"
      Stop-Tree $opid
      Start-Sleep -Seconds 2
    }

    Ensure-Db

    $child = Start-Dev

    # Wait for the pinned port (guards against next dev silently hopping ports).
    $up = $false
    $deadline = (Get-Date).AddSeconds($PortWaitSec)
    while ((Get-Date) -lt $deadline) {
      if ($child.HasExited) { break }
      if (Test-Listening $Port) { $up = $true; break }
      Start-Sleep -Seconds 2
    }

    if (-not $up) {
      if ($child.HasExited) {
        WLog ("dev exited early code={0}" -f $child.ExitCode)
      } else {
        WLog "port $Port not bound within ${PortWaitSec}s -> killing child (port stolen?)"
        Stop-Tree $child.Id
      }
      $failStreak++
    } else {
      WLog ("dev up pid={0} on port {1}" -f $child.Id, $Port)
      $child.WaitForExit()
      $failStreak = 0
      WLog ("dev EXIT pid={0} code={1}" -f $child.Id, $child.ExitCode)
    }
  } catch {
    WLog ("watchdog error: " + $_.Exception.Message)
    $failStreak++
  }

  if ($failStreak -gt 0) {
    $delay = [int][Math]::Min(30, 3 * [Math]::Pow(2, [Math]::Min($failStreak, 5)))
    WLog ("backoff {0}s (streak={1})" -f $delay, $failStreak)
    Start-Sleep -Seconds $delay
  } else {
    Start-Sleep -Seconds 2
  }
}
