param(
  [string[]]$Servers = @("43.133.91.197"),
  [string]$ServerUser = "root",
  [string]$SshKey = "",
  [string]$ConfigFile = "deploy\nginx\veldr-frontends.conf",
  [string]$RemoteConfigPath = "/etc/nginx/conf.d/veldr-frontends.conf",
  [switch]$ReplaceSharedStream,
  [string[]]$RequiredSniHosts = @(
    "notes.lifetip.top",
    "cms.lifetip.top",
    "nav.lifetip.top",
    "gotify.lifetip.top",
    "igotify.lifetip.top",
    "ws.lifetip.top"
  )
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$localConfigPath = Join-Path $repoRoot $ConfigFile

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

if (-not (Test-Path -LiteralPath $localConfigPath)) {
  throw "Missing nginx config: $localConfigPath"
}

Assert-Command "scp"
Assert-Command "ssh"

$sshArgs = @()
if ($SshKey) {
  $sshArgs += @("-i", $SshKey)
}

$localStreamPath = Join-Path $repoRoot "deploy\nginx\veldr-stream.conf"
$remoteStreamPath = "/etc/nginx/stream-conf.d/veldr-sni.conf"
$quotedSniHosts = ($RequiredSniHosts | ForEach-Object { Quote-Sh $_ }) -join " "
$remoteHostVariable = '$host'

if ($ReplaceSharedStream -and -not (Test-Path -LiteralPath $localStreamPath)) {
  throw "Missing shared stream template: $localStreamPath"
}

foreach ($server in $Servers) {
  $target = Get-Target $server
  $remoteTmpPath = "/tmp/veldr-frontends.conf"
  $remoteTmpStream = "/tmp/veldr-stream.conf"

  Invoke-Checked "Uploading nginx configs to $target" {
    & scp @sshArgs $localConfigPath "${target}:${remoteTmpPath}"
    if ($LASTEXITCODE -eq 0 -and $ReplaceSharedStream) {
      & scp @sshArgs $localStreamPath "${target}:${remoteTmpStream}"
    }
  }

  $remoteCommand = @(
    "set -e",
    "command -v nginx >/dev/null 2>&1",
    "command -v openssl >/dev/null 2>&1",
    "test -f $(Quote-Sh $remoteStreamPath)",
    "for host in $quotedSniHosts; do grep -Fq '$remoteHostVariable ' $(Quote-Sh $remoteStreamPath); done",
    "mkdir -p $(Quote-Sh (Get-PosixParent $RemoteConfigPath))",
    "if [ -f $(Quote-Sh $RemoteConfigPath) ]; then cp $(Quote-Sh $RemoteConfigPath) $(Quote-Sh "$RemoteConfigPath.bak-`$(date +%Y%m%d-%H%M%S)"); fi",
    "mv $(Quote-Sh $remoteTmpPath) $(Quote-Sh $RemoteConfigPath)",
    "if [ -f $(Quote-Sh $remoteTmpStream) ]; then cp $(Quote-Sh $remoteStreamPath) $(Quote-Sh "$remoteStreamPath.bak-`$(date +%Y%m%d-%H%M%S)"); mv $(Quote-Sh $remoteTmpStream) $(Quote-Sh $remoteStreamPath); fi",
    "nginx -t",
    "systemctl reload nginx",
    "for host in $quotedSniHosts; do timeout 8 openssl s_client -connect 127.0.0.1:443 -servername $remoteHostVariable -brief </dev/null >/dev/null; done"
  ) -join " && "

  Invoke-Checked "Installing and reloading nginx on $target" {
    & ssh @sshArgs $target $remoteCommand
  }
}

Write-Host ""
Write-Host "Nginx deployment complete." -ForegroundColor Green
