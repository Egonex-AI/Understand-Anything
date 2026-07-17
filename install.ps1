<#
.SYNOPSIS
  Understand-Anything installer for Windows (PowerShell).

.DESCRIPTION
  Clones the repo and creates skill symlinks/junctions for the chosen platform.

.EXAMPLE
  ./install.ps1                       # prompt for platform
  ./install.ps1 codex                 # install for codex
  ./install.ps1 -Update               # pull latest changes
  ./install.ps1 -Uninstall codex      # remove links for codex
#>

param(
    [Parameter(Position = 0)]
    [string]$Platform,
    [switch]$Update,
    [string]$Uninstall,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

$RepoUrl    = if ($env:UA_REPO_URL) { $env:UA_REPO_URL } else { 'https://github.com/Egonex-AI/Understand-Anything.git' }
$RepoDir    = if ($env:UA_DIR)      { $env:UA_DIR }      else { Join-Path $HOME '.understand-anything\repo' }
$PluginLink = Join-Path $HOME '.understand-anything-plugin'

# Platform table — Target = skills directory; Style = "per-skill" | "folder";
# AgentsTarget is empty for platforms that need a custom agent bundle format.
$Platforms = [ordered]@{
    gemini      = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill'; AgentsTarget = (Join-Path $HOME '.agents\agents') }
    codex       = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill'; AgentsTarget = (Join-Path $HOME '.agents\agents') }
    opencode    = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill'; AgentsTarget = (Join-Path $HOME '.agents\agents') }
    pi          = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill'; AgentsTarget = (Join-Path $HOME '.agents\agents') }
    openclaw    = @{ Target = (Join-Path $HOME '.openclaw\skills');           Style = 'folder';    AgentsTarget = (Join-Path $HOME '.openclaw\agents') }
    antigravity = @{ Target = (Join-Path $HOME '.gemini\antigravity\skills'); Style = 'folder';    AgentsTarget = (Join-Path $HOME '.gemini\antigravity\agents') }
    vibe        = @{ Target = (Join-Path $HOME '.vibe\skills');               Style = 'per-skill'; AgentsTarget = (Join-Path $HOME '.vibe\agents') }
    vscode      = @{ Target = (Join-Path $HOME '.copilot\skills');            Style = 'per-skill'; AgentsTarget = (Join-Path $HOME '.copilot\agents') }
    hermes      = @{ Target = (Join-Path $HOME '.hermes\skills');             Style = 'folder';    AgentsTarget = (Join-Path $HOME '.hermes\agents') }
    cline       = @{ Target = (Join-Path $HOME '.cline\skills');              Style = 'folder';    AgentsTarget = (Join-Path $HOME '.cline\agents') }
    kimi        = @{ Target = (Join-Path $HOME '.kimi\skills');               Style = 'folder';    AgentsTarget = (Join-Path $HOME '.kimi\agents') }
    trae        = @{ Target = (Join-Path $HOME '.trae\skills');               Style = 'per-skill'; AgentsTarget = (Join-Path $HOME '.trae\agents') }
    nanobot     = @{ Target = (Join-Path $HOME '.nanobot\workspace\skills');  Style = 'per-skill'; AgentsTarget = (Join-Path $HOME '.nanobot\workspace\agents') }
    kiro        = @{ Target = (Join-Path $HOME '.kiro\skills');               Style = 'per-skill'; AgentsTarget = '' }
}

function Show-Usage {
    @"
Understand-Anything installer (Windows)

Usage:
  install.ps1 [<platform>]                Install for <platform> (or prompt if omitted)
  install.ps1 -Update                     Pull latest changes
  install.ps1 -Uninstall <platform>       Remove links for <platform>
  install.ps1 -Help

Supported platforms:
$($Platforms.Keys -join ', ')

Environment:
  UA_REPO_URL   Override clone URL
  UA_DIR        Override clone destination (default: %USERPROFILE%\.understand-anything\repo)
"@
}

function Resolve-Platform([string]$Id) {
    if (-not $Platforms.Contains($Id)) {
        Write-Error "Unknown platform: $Id. Supported: $($Platforms.Keys -join ', ')"
    }
    return $Platforms[$Id]
}

function Prompt-Platform {
    $ids = @($Platforms.Keys)
    Write-Host 'Which platform are you installing for?'
    for ($i = 0; $i -lt $ids.Count; $i++) {
        Write-Host ("  {0}) {1}" -f ($i + 1), $ids[$i])
    }
    $choice = Read-Host ("Choose [1-{0}]" -f $ids.Count)
    $n = 0
    if (-not [int]::TryParse($choice, [ref]$n) -or $n -lt 1 -or $n -gt $ids.Count) {
        Write-Error "Invalid choice: $choice"
    }
    return $ids[$n - 1]
}

function Get-SkillsRoot { Join-Path $RepoDir 'understand-anything-plugin\skills' }
function Get-AgentsRoot { Join-Path $RepoDir 'understand-anything-plugin\agents' }

function Clone-Or-Update {
    if (Test-Path (Join-Path $RepoDir '.git')) {
        Write-Host "→ Updating existing checkout at $RepoDir"
        git -C $RepoDir pull --ff-only
    } else {
        Write-Host "→ Cloning $RepoUrl → $RepoDir"
        $parent = Split-Path -Parent $RepoDir
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        git clone $RepoUrl $RepoDir
    }
}

function Get-SkillNames {
    $root = Get-SkillsRoot
    if (-not (Test-Path $root)) { Write-Error "Skills directory not found: $root" }
    Get-ChildItem -Path $root -Directory | Select-Object -ExpandProperty Name
}

function Test-IsReparse([string]$Path) {
    if (-not (Test-Path $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force
    return ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink')
}

function Remove-Reparse([string]$Path) {
    # Removes a junction/symlink without touching its target. Refuses to touch
    # real files or directories so an existing user folder at the same path is
    # never destroyed.
    if (-not (Test-Path $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') {
        $item.Delete()
        return $true
    }
    Write-Warning "Refusing to delete $Path — it is a real file/directory, not a junction/symlink we created. Remove it manually if you intended to."
    return $false
}

function New-Junction([string]$LinkPath, [string]$TargetPath) {
    if (Test-Path $LinkPath) {
        if (Test-IsReparse $LinkPath) {
            (Get-Item -LiteralPath $LinkPath -Force).Delete()
        } else {
            Write-Error "Refusing to overwrite $LinkPath — it is a real file/directory, not a junction. Move or remove it first."
        }
    }
    New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath | Out-Null
}

function Link-Skills([string]$Target, [string]$Style) {
    $root = Get-SkillsRoot
    if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target | Out-Null }

    switch ($Style) {
        'per-skill' {
            foreach ($skill in Get-SkillNames) {
                $link = Join-Path $Target $skill
                $src  = Join-Path $root $skill
                New-Junction $link $src
                Write-Host "  ✓ $link → $src"
            }
        }
        'folder' {
            $link = Join-Path $Target 'understand-anything'
            New-Junction $link $root
            Write-Host "  ✓ $link → $root"
        }
        default { Write-Error "Unknown style: $Style" }
    }
}

function Unlink-Skills([string]$Target, [string]$Style) {
    if (-not (Test-Path $Target)) { return }
    switch ($Style) {
        'per-skill' {
            $skillsRoot = Get-SkillsRoot
            if (Test-Path $skillsRoot) {
                foreach ($skill in Get-SkillNames) {
                    Remove-Reparse (Join-Path $Target $skill) | Out-Null
                }
            } else {
                # Checkout is gone — scan the target dir for stale links pointing
                # into our plugin tree so we can still clean up.
                Get-ChildItem -LiteralPath $Target -Force | ForEach-Object {
                    if ($_.LinkType -eq 'Junction' -or $_.LinkType -eq 'SymbolicLink') {
                        if ($_.Target -match 'understand-anything-plugin[\\/]+skills[\\/]+') {
                            Remove-Reparse $_.FullName | Out-Null
                        }
                    }
                }
            }
        }
        'folder' {
            Remove-Reparse (Join-Path $Target 'understand-anything') | Out-Null
        }
    }
}

function Link-Plugin-Root {
    if (Test-Path $PluginLink) {
        Write-Host "  • $PluginLink already exists, leaving as-is"
    } else {
        $src = Join-Path $RepoDir 'understand-anything-plugin'
        New-Item -ItemType Junction -Path $PluginLink -Target $src | Out-Null
        Write-Host "  ✓ $PluginLink → $src"
    }
}

function Link-AgentProfiles([string]$Target) {
    if (-not $Target) { return }
    $root = Get-AgentsRoot
    if (-not (Test-Path $root)) { Write-Error "Agents directory not found: $root" }
    if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target | Out-Null }

    Get-ChildItem -Path $root -Filter '*.md' -File | Sort-Object Name | ForEach-Object {
        $link = Join-Path $Target $_.Name
        New-Junction $link $_.FullName
        Write-Host "  ✓ $link → $($_.FullName)"
    }
}

function Unlink-AgentProfiles([string]$Target) {
    if (-not $Target) { return }
    if (-not (Test-Path $Target)) { return }

    $root = Get-AgentsRoot
    if (Test-Path $root) {
        Get-ChildItem -Path $root -Filter '*.md' -File | ForEach-Object {
            Remove-Reparse (Join-Path $Target $_.Name) | Out-Null
        }
    } else {
        Get-ChildItem -LiteralPath $Target -Filter '*.md' -Force | ForEach-Object {
            if ($_.LinkType -eq 'Junction' -or $_.LinkType -eq 'SymbolicLink') {
                if ($_.Target -match 'understand-anything-plugin[\\/]+agents[\\/]+') {
                    Remove-Reparse $_.FullName | Out-Null
                }
            }
        }
    }
}

function ConvertTo-FileUri([string]$Path) {
    # Produce a forward-slashed file URI (Windows: file:///C:/path/...).
    return 'file:///' + ($Path -replace '\\', '/')
}

function Cmd-Install([string]$Id) {
    $cfg = Resolve-Platform $Id
    Clone-Or-Update
    Write-Host "→ Linking skills for $Id ($($cfg.Style) → $($cfg.Target))"
    Link-Skills $cfg.Target $cfg.Style
    Write-Host '→ Linking universal plugin root'
    Link-Plugin-Root

    if ($cfg.AgentsTarget) {
        Write-Host "→ Linking agent profiles ($($cfg.AgentsTarget))"
        Link-AgentProfiles $cfg.AgentsTarget
    }

    if ($Id -eq 'kiro') {
        Write-Host '→ Creating Kiro agent configuration'
        $agentsDir = Join-Path $HOME '.kiro\agents'
        if (-not (Test-Path $agentsDir)) { New-Item -ItemType Directory -Path $agentsDir | Out-Null }
        $pluginRoot = Join-Path $RepoDir 'understand-anything-plugin'

        # Build the "resources" list dynamically from the agent definitions in
        # the repo so it never drifts as agents are added or removed.
        $resources = @(
            Get-ChildItem -Path (Join-Path $pluginRoot 'agents') -Filter '*.md' -File |
                Sort-Object Name |
                ForEach-Object { ConvertTo-FileUri $_.FullName }
        )
        $agent = [ordered]@{
            name        = 'understand'
            description = 'Analyze codebase into interactive knowledge graph — Understand Anything'
            prompt      = ConvertTo-FileUri (Join-Path $pluginRoot 'skills\understand\SKILL.md')
            tools       = @('read', 'write', 'shell', 'grep', 'glob', 'code', 'subagent')
            resources   = $resources
        }
        $agentJson = Join-Path $agentsDir 'understand.json'
        # WriteAllText emits UTF-8 without a BOM on every PowerShell version.
        [System.IO.File]::WriteAllText($agentJson, ($agent | ConvertTo-Json -Depth 5))
        Write-Host "  ✓ $agentJson"
    }

    Write-Host "`n✓ Installed Understand-Anything for $Id"
    Write-Host '  Restart your CLI or IDE to pick up the skills.'
    if ($Id -eq 'codex') {
        Write-Host "`n  Tip: Codex invokes skills with `$ instead of / — type `$understand, not /understand."
    }
    if ($Id -eq 'vscode') {
        Write-Host "`n  Tip: VS Code can also auto-discover the plugin by opening this repo"
        Write-Host '       directly (it reads .copilot-plugin/plugin.json), no symlinks needed.'
    }
    if ($Id -eq 'kiro') {
        Write-Host "`n  Usage: kiro-cli chat --agent understand `"Analyze this project`""
    }
}

function Cmd-Uninstall([string]$Id) {
    $cfg = Resolve-Platform $Id
    Write-Host "→ Removing skill links for $Id"
    Unlink-Skills $cfg.Target $cfg.Style
    if ($Id -eq 'kiro') {
        $agentJson = Join-Path $HOME '.kiro\agents\understand.json'
        if (Test-Path $agentJson) {
            Remove-Item -LiteralPath $agentJson -Force
            Write-Host "  ✓ removed $agentJson"
        }
    }
    if ($cfg.AgentsTarget) {
        Write-Host '→ Removing agent profile links'
        Unlink-AgentProfiles $cfg.AgentsTarget
    }
    if (Remove-Reparse $PluginLink) {
        Write-Host "  ✓ removed $PluginLink"
    }
    if (Test-Path $RepoDir) {
        Write-Host "`nThe checkout at $RepoDir was kept (other platforms may still use it)."
        Write-Host "To remove it: Remove-Item -Recurse -Force '$RepoDir'"
    }
}

function Cmd-Update {
    if (-not (Test-Path (Join-Path $RepoDir '.git'))) {
        Write-Error "No installation found at $RepoDir. Run install first."
    }
    git -C $RepoDir pull --ff-only
    Write-Host '✓ Updated.'
}

if ($Help) { Show-Usage; return }
if ($Update) { Cmd-Update; return }
if ($Uninstall) { Cmd-Uninstall $Uninstall; return }

if (-not $Platform) { $Platform = Prompt-Platform }
Cmd-Install $Platform
