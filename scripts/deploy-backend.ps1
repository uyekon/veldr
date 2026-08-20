param(
  [string[]]$Servers = @("43.133.91.197"),
  [string]$ServerUser = "root",
  [string]$SshKey = "",
  [string]$RemoteBackendPath = "/opt/veldr/backend",
  [string]$ServiceName = "veldr-backend",
  [string]$EnvFile = "backend\.env.prod",
  [switch]$Deploy,
  [switch]$SkipInstall,
  [switch]$SkipService,
  [switch]$UploadEnv,
  [switch]$DeployCmsCleanupTimer,
  [switch]$KeepPackage
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $repoRoot "backend"
$servicePath = Join-Path $repoRoot "deploy\systemd\veldr-backend.service"
$cleanupServicePath = Join-Path $repoRoot "deploy\systemd\veldr-cms-upload-cleanup.service"
$cleanupTimerPath = Join-Path $repoRoot "deploy\systemd\veldr-cms-upload-cleanup.timer"
$archiveName = "veldr-backend.tgz"
$archivePath = Join-Path $backendPath $archiveName
$uploadEnvPath = Join-Path $backendPath ".veldr-backend.env.upload"

function Invoke-Checked {
  param(
    [string]$Title,
    [scriptblock]$Script
  )

  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
  $global:LASTEXITCODE = $null
  & $Script
  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Get-Target {
  param([string]$Server)
  if ($Server -match "@") {
    return $Server
  }
  return "${ServerUser}@${Server}"
}

function Quote-Sh {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\''") + "'"
}

function Get-PosixParent {
  param([string]$Path)
  $normalized = $Path.TrimEnd("/")
  $index = $normalized.LastIndexOf("/")
  if ($index -le 0) {
    return "/"
  }
  return $normalized.Substring(0, $index)
}

function Get-PosixLeaf {
  param([string]$Path)
  return $Path.TrimEnd("/").Substring($Path.TrimEnd("/").LastIndexOf("/") + 1)
}

function Invoke-InBackend {
  param([scriptblock]$Script)
  Push-Location $backendPath
  try {
    & $Script
  }
  finally {
    Pop-Location
  }
}

function Remove-LocalArchive {
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
}

Assert-Command "npm"
Assert-Command "tar"

if (-not (Test-Path -LiteralPath $backendPath)) {
  throw "Missing backend folder: $backendPath"
}

if (-not (Test-Path -LiteralPath $servicePath)) {
  throw "Missing systemd service file: $servicePath"
}

if ($DeployCmsCleanupTimer -and ((-not (Test-Path -LiteralPath $cleanupServicePath)) -or (-not (Test-Path -LiteralPath $cleanupTimerPath)))) {
  throw "Missing CMS cleanup systemd files under deploy\systemd"
}

if ($UploadEnv) {
  $resolvedEnvFile = Join-Path $repoRoot $EnvFile
  if (-not (Test-Path -LiteralPath $resolvedEnvFile)) {
    throw "Env file not found: $resolvedEnvFile"
  }

  $envContent = Get-Content -LiteralPath $resolvedEnvFile -Raw
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($uploadEnvPath, $envContent, $utf8NoBom)
}

Invoke-Checked "Testing backend" {
  Invoke-InBackend {
    npm test
  }
}

Invoke-Checked "Packing backend" {
  Invoke-InBackend {
    if (Test-Path -LiteralPath $archiveName) {
      Remove-Item -LiteralPath $archiveName -Force
    }

    tar -czf $archiveName `
      --exclude="node_modules" `
      --exclude="public/data" `
      --exclude="public/uploads" `
      --exclude="public.zip" `
      --exclude="temp" `
      --exclude="*.tgz" `
      --exclude="*-backup-*" `
      --exclude=".env" `
      --exclude=".env.*" `
      .
  }
}

if (-not $Deploy) {
  Write-Host ""
  Write-Host "Backend package is ready:" -ForegroundColor Green
  Write-Host "  $archivePath"
  Write-Host ""
  Write-Host "Run with -Deploy to upload to: $($Servers -join ', ')"
  exit 0
}

Assert-Command "scp"
Assert-Command "ssh"

$sshArgs = @()
if ($SshKey) {
  $sshArgs += @("-i", $SshKey)
}

$remoteParent = Get-PosixParent $RemoteBackendPath
$remoteName = Get-PosixLeaf $RemoteBackendPath

foreach ($server in $Servers) {
  $target = Get-Target $server

  Invoke-Checked "Ensuring remote backend parent on $target" {
    $remoteCommand = "mkdir -p $(Quote-Sh $remoteParent)"
    & ssh @sshArgs $target $remoteCommand
  }

  Invoke-Checked "Uploading backend package to $target" {
    & scp @sshArgs $archivePath "${target}:${remoteParent}/${archiveName}"
  }

  if ($UploadEnv) {
    Invoke-Checked "Uploading backend env to $target" {
      & scp @sshArgs $uploadEnvPath "${target}:${remoteParent}/veldr-backend.env"
    }
  }

  if (-not $SkipService) {
    Invoke-Checked "Uploading systemd service to $target" {
      & scp @sshArgs $servicePath "${target}:/tmp/${ServiceName}.service"
    }
  }

  if ($DeployCmsCleanupTimer) {
    Invoke-Checked "Uploading CMS cleanup timer files to $target" {
      & scp @sshArgs $cleanupServicePath "${target}:/tmp/veldr-cms-upload-cleanup.service"
      & scp @sshArgs $cleanupTimerPath "${target}:/tmp/veldr-cms-upload-cleanup.timer"
    }
  }

  $remoteCommand = @(
    "set -e",
    "cd $(Quote-Sh $remoteParent)",
    "rm -rf veldr-backend-runtime",
    "mkdir -p veldr-backend-runtime",
    "BACKUP=`$(date +%Y%m%d-%H%M%S)",
    "if [ -d $(Quote-Sh $remoteName) ]; then if [ -d $(Quote-Sh "$remoteName/public/data") ]; then mkdir -p veldr-backend-runtime/public; mv $(Quote-Sh "$remoteName/public/data") veldr-backend-runtime/public/data; fi; if [ -d $(Quote-Sh "$remoteName/public/uploads") ]; then mkdir -p veldr-backend-runtime/public; mv $(Quote-Sh "$remoteName/public/uploads") veldr-backend-runtime/public/uploads; fi; if [ -d $(Quote-Sh "$remoteName/temp") ]; then mv $(Quote-Sh "$remoteName/temp") veldr-backend-runtime/temp; fi; if [ -f $(Quote-Sh "$remoteName/.env") ]; then mv $(Quote-Sh "$remoteName/.env") veldr-backend-runtime/.env; fi; mv $(Quote-Sh $remoteName) $(Quote-Sh $remoteName)-`$BACKUP; fi",
    "mkdir -p $(Quote-Sh $remoteName)",
    "tar -xzf $(Quote-Sh $archiveName) -C $(Quote-Sh $remoteName)",
    "rm $(Quote-Sh $archiveName)",
    "if [ -d veldr-backend-runtime/public/data ]; then mkdir -p $(Quote-Sh "$remoteName/public"); mv veldr-backend-runtime/public/data $(Quote-Sh "$remoteName/public/data"); fi",
    "if [ -d veldr-backend-runtime/public/uploads ]; then mkdir -p $(Quote-Sh "$remoteName/public"); mv veldr-backend-runtime/public/uploads $(Quote-Sh "$remoteName/public/uploads"); fi",
    "if [ -d veldr-backend-runtime/temp ]; then mv veldr-backend-runtime/temp $(Quote-Sh "$remoteName/temp"); fi",
    "if [ -f veldr-backend-runtime/.env ]; then mv veldr-backend-runtime/.env $(Quote-Sh "$remoteName/.env"); fi",
    "rm -rf veldr-backend-runtime",
    "mkdir -p $(Quote-Sh "$remoteName/public/data") $(Quote-Sh "$remoteName/public/uploads") $(Quote-Sh "$remoteName/temp")",
    "if [ -f veldr-backend.env ]; then mv veldr-backend.env $(Quote-Sh "$remoteName/.env"); fi"
  )

  if (-not $SkipInstall) {
    $remoteCommand += "cd $(Quote-Sh $remoteName) && npm ci --omit=dev"
  }

  if (-not $SkipService) {
    $remoteCommand += "mv /tmp/$(Quote-Sh "$ServiceName.service") /etc/systemd/system/$(Quote-Sh "$ServiceName.service")"
    $remoteCommand += "systemctl daemon-reload"
    $remoteCommand += "systemctl enable $(Quote-Sh $ServiceName)"
    $remoteCommand += "systemctl restart $(Quote-Sh $ServiceName)"
    $remoteCommand += "systemctl --no-pager --full status $(Quote-Sh $ServiceName)"
  }

  if ($DeployCmsCleanupTimer) {
    $remoteCommand += "mv /tmp/veldr-cms-upload-cleanup.service /etc/systemd/system/veldr-cms-upload-cleanup.service"
    $remoteCommand += "mv /tmp/veldr-cms-upload-cleanup.timer /etc/systemd/system/veldr-cms-upload-cleanup.timer"
    $remoteCommand += "systemctl daemon-reload"
    $remoteCommand += "systemctl enable --now veldr-cms-upload-cleanup.timer"
    $remoteCommand += "systemctl --no-pager --full status veldr-cms-upload-cleanup.timer"
  }

  Invoke-Checked "Activating backend on $target" {
    & ssh @sshArgs $target ($remoteCommand -join " && ")
  }
}

if (-not $KeepPackage) {
  Remove-LocalArchive
}

if (Test-Path -LiteralPath $uploadEnvPath) {
  Remove-Item -LiteralPath $uploadEnvPath -Force
}

Write-Host ""
Write-Host "Backend deployment complete." -ForegroundColor Green
