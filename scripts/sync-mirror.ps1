param(
  [ValidateSet("drive-to-cache", "cache-to-drive")]
  [string]$Direction = "cache-to-drive",
  [string]$DriveRoot = "g:\My Drive\random bs\mutual graph",
  [string]$CacheRoot = "c:\dev-cache\mutual-graph-worktree"
)

$ErrorActionPreference = "Stop"

if ($Direction -eq "drive-to-cache") {
  $source = $DriveRoot
  $target = $CacheRoot
} else {
  $source = $CacheRoot
  $target = $DriveRoot
}

if (-not (Test-Path $source)) {
  Write-Error "Source path not found: $source"
}

if (-not (Test-Path $target)) {
  New-Item -Path $target -ItemType Directory -Force | Out-Null
}

$excludeDirs = @(
  "node_modules",
  "dist",
  ".wrangler",
  ".git",
  ".vscode",
  "node_modules_broken_20260306_214404"
)

$excludeFiles = @(
  "*.tmp",
  "*.swp",
  "npm-debug.log*"
)

$robocopyArgs = @(
  $source,
  $target,
  "/MIR",
  "/R:1",
  "/W:1",
  "/NFL",
  "/NDL",
  "/NJH",
  "/NJS",
  "/NP",
  "/XD"
) + $excludeDirs + @("/XF") + $excludeFiles

& robocopy @robocopyArgs | Out-Null
$code = $LASTEXITCODE

# Robocopy exit codes: 0-7 are success-ish, >= 8 is failure.
if ($code -ge 8) {
  Write-Error "Robocopy failed with exit code $code."
}

Write-Host "Sync completed: $Direction"
