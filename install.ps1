# Activate a locally prepared, independently approved release.
param(
    [Parameter(Position = 0)] [string]$Platform,
    [string]$Commit,
    [string]$ManifestSha256,
    [switch]$Update,
    [string]$Uninstall,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'

# Compatibility table (also checked by the platform consistency test).
$Platforms = [ordered]@{
    gemini      = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    codex       = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    opencode    = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    pi          = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    openclaw    = @{ Target = (Join-Path $HOME '.openclaw\skills');           Style = 'folder' }
    antigravity = @{ Target = (Join-Path $HOME '.gemini\antigravity\skills'); Style = 'folder' }
    vibe        = @{ Target = (Join-Path $HOME '.vibe\skills');               Style = 'per-skill' }
    vscode      = @{ Target = (Join-Path $HOME '.copilot\skills');            Style = 'per-skill' }
    hermes      = @{ Target = (Join-Path $HOME '.hermes\skills');             Style = 'folder' }
    cline       = @{ Target = (Join-Path $HOME '.cline\skills');              Style = 'folder' }
    kimi        = @{ Target = (Join-Path $HOME '.kimi-code\skills');          Style = 'folder' }
    trae        = @{ Target = (Join-Path $HOME '.trae\skills');               Style = 'per-skill' }
    nanobot     = @{ Target = (Join-Path $HOME '.nanobot\workspace\skills');  Style = 'per-skill' }
    kiro        = @{ Target = (Join-Path $HOME '.kiro\skills');               Style = 'per-skill' }
    devin       = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
}

$installer = Join-Path $PSScriptRoot 'scripts/secure-install.py'
$cli = @()
if ($Platform) { $cli += $Platform }
if ($Commit) { $cli += @('--commit', $Commit) }
if ($ManifestSha256) { $cli += @('--manifest-sha256', $ManifestSha256) }
if ($Update) { $cli += '--update' }
if ($Uninstall) { $cli += @('--uninstall', $Uninstall) }
if ($Help) { $cli += '--help' }
if (Get-Command python -ErrorAction SilentlyContinue) {
    & python $installer @cli
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 $installer @cli
} else {
    throw 'Python 3.9 or later is required.'
}
exit $LASTEXITCODE
