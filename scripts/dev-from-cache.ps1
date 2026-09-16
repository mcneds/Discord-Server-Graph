param(
  [string]$DriveRoot = "g:\My Drive\random bs\mutual graph",
  [string]$CacheRoot = "c:\dev-cache\mutual-graph-worktree",
  [int]$PollMs = 1200
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$syncScript = Join-Path $scriptRoot "sync-mirror.ps1"

if (-not (Test-Path $syncScript)) {
  Write-Error "Missing sync script: $syncScript"
}

if (-not (Test-Path $CacheRoot)) {
  Write-Error "Cache root not found: $CacheRoot"
}

Write-Host "Initial sync: drive -> cache"
& $syncScript -Direction "drive-to-cache" -DriveRoot $DriveRoot -CacheRoot $CacheRoot

$syncLoop = {
  param($syncScriptPath, $drivePath, $cachePath, $intervalMs)
  while ($true) {
    try {
      & $syncScriptPath -Direction "drive-to-cache" -DriveRoot $drivePath -CacheRoot $cachePath | Out-Null
    } catch {
      # Keep loop alive; transient mirror issues should not kill dev server.
    }
    Start-Sleep -Milliseconds $intervalMs
  }
}

$job = Start-Job -ScriptBlock $syncLoop -ArgumentList $syncScript, $DriveRoot, $CacheRoot, $PollMs

try {
  Push-Location $CacheRoot
  npm run dev
} finally {
  if ($job) {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
  }

  Pop-Location

  Write-Host "Final sync: cache -> drive"
  & $syncScript -Direction "cache-to-drive" -DriveRoot $DriveRoot -CacheRoot $CacheRoot
}
