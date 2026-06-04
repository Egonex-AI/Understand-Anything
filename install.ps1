<#
.SYNOPSIS
  Understand-Anything installer for Windows (PowerShell).

.DESCRIPTION
  Clones the repo and creates skill symlinks/junctions for the chosen platform.

.EXAMPLE
  ./install.ps1                       # prompt for platform
  ./install.ps1 codex                 # install for codex
  ./install.ps1 forgecode              # install for ForgeCode
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

$RepoUrl    = if ($env:UA_REPO_URL) { $env:UA_REPO_URL } else { 'https://github.com/Lum1104/Understand-Anything.git' }
$RepoRef    = if ($env:UA_REPO_REF) { $env:UA_REPO_REF } else { '' }
$RepoDir    = if ($env:UA_DIR)      { $env:UA_DIR }      else { Join-Path $HOME '.understand-anything\repo' }
$PluginLink = Join-Path $HOME '.understand-anything-plugin'

# Platform table — Target = skills directory; Style = "per-skill" | "copy-per-skill" | "folder"
$Platforms = [ordered]@{
    gemini      = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    codex       = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    opencode    = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    forgecode   = @{ Target = 'AUTO';                                         Style = 'copy-per-skill' }
    pi          = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    openclaw    = @{ Target = (Join-Path $HOME '.openclaw\skills');           Style = 'folder' }
    antigravity = @{ Target = (Join-Path $HOME '.gemini\antigravity\skills'); Style = 'folder' }
    vscode      = @{ Target = (Join-Path $HOME '.copilot\skills');            Style = 'per-skill' }
    hermes      = @{ Target = (Join-Path $HOME '.hermes\skills');             Style = 'folder' }
    cline       = @{ Target = (Join-Path $HOME '.cline\skills');              Style = 'folder' }
    kimi        = @{ Target = (Join-Path $HOME '.kimi\skills');               Style = 'folder' }
    trae        = @{ Target = (Join-Path $HOME '.trae\skills');               Style = 'per-skill' }
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
  UA_REPO_REF   Optional git ref to checkout after clone/update
  UA_DIR        Override clone destination (default: %USERPROFILE%\.understand-anything\repo)
"@
}

function Resolve-Platform([string]$Id) {
    if (-not $Platforms.Contains($Id)) {
        Write-Error "Unknown platform: $Id. Supported: $($Platforms.Keys -join ', ')"
    }
    return $Platforms[$Id]
}

function Get-ForgeCodeBaseDir {
    # ForgeCode base-path resolution:
    # 1) $env:FORGE_CONFIG when set
    # 2) ~/forge (default)
    # 3) ~/.forge (fallback for older installs)
    if ($env:FORGE_CONFIG) { return $env:FORGE_CONFIG }

    $default = Join-Path $HOME 'forge'
    if (Test-Path $default) { return $default }

    $fallback = Join-Path $HOME '.forge'
    if (Test-Path $fallback) { return $fallback }

    return $default
}

function Resolve-TargetDir([string]$Id, [string]$Target) {
    switch ($Id) {
        'forgecode' {
            return (Join-Path (Get-ForgeCodeBaseDir) 'skills')
        }
        default {
            return $Target
        }
    }
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
function Get-CommandsRoot { Join-Path $RepoDir 'understand-anything-plugin\commands' }
function Get-ForgeCodeAgentsRoot { Join-Path $RepoDir 'understand-anything-plugin\forgecode\agents' }

function Clone-Or-Update {
    if (Test-Path (Join-Path $RepoDir '.git')) {
        Write-Host "→ Updating existing checkout at $RepoDir"
        if ($env:UA_REPO_URL) {
            git -C $RepoDir remote set-url origin $RepoUrl
        }
        git -C $RepoDir fetch --all --prune
    } else {
        Write-Host "→ Cloning $RepoUrl → $RepoDir"
        $parent = Split-Path -Parent $RepoDir
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        git clone $RepoUrl $RepoDir
    }

    if ($RepoRef) {
        Write-Host "→ Checking out $RepoRef"
        git -C $RepoDir checkout -q $RepoRef
        if ($LASTEXITCODE -ne 0) {
            git -C $RepoDir checkout -q -B $RepoRef "origin/$RepoRef"
        }
    }

    # If we're on a branch, keep it fast-forwarded.
    git -C $RepoDir symbolic-ref -q HEAD *> $null
    if ($LASTEXITCODE -eq 0) {
        git -C $RepoDir pull --ff-only
    }
}

function Get-SkillNames {
    $root = Get-SkillsRoot
    if (-not (Test-Path $root)) { Write-Error "Skills directory not found: $root" }
    Get-ChildItem -Path $root -Directory | Select-Object -ExpandProperty Name
}

function Get-CommandFiles {
    $root = Get-CommandsRoot
    if (-not (Test-Path $root)) { Write-Error "Commands directory not found: $root" }
    Get-ChildItem -Path $root -File -Filter '*.md' | Select-Object -ExpandProperty Name
}

function Get-ForgeCodeAgentFiles {
    $root = Get-ForgeCodeAgentsRoot
    if (-not (Test-Path $root)) { Write-Error "ForgeCode agents directory not found: $root" }
    Get-ChildItem -Path $root -File -Filter '*.md' | Select-Object -ExpandProperty Name
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

function Install-ForgeCodeCommands {
    $base = Get-ForgeCodeBaseDir
    $target = Join-Path $base 'commands'
    $root = Get-CommandsRoot

    if (-not (Test-Path $root)) {
        Write-Warning "ForgeCode commands not found in checkout: $root"
        Write-Warning 'If you are testing a fork/branch, set UA_REPO_URL and optionally UA_REPO_REF.'
        return
    }
    if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }

    foreach ($cmd in Get-CommandFiles) {
        $src = Join-Path $root $cmd
        $dest = Join-Path $target $cmd
        Copy-Item -LiteralPath $src -Destination $dest -Force
        Write-Host "  ✓ $dest ← $src"
    }
}

function Uninstall-ForgeCodeCommands {
    $base = Get-ForgeCodeBaseDir
    $target = Join-Path $base 'commands'
    $root = Get-CommandsRoot

    if (-not (Test-Path $target)) { return }
    if (-not (Test-Path $root)) {
        Write-Warning "Commands checkout not found; remove copied command files manually under: $target"
        return
    }

    foreach ($cmd in Get-CommandFiles) {
        $src = Join-Path $root $cmd
        $dest = Join-Path $target $cmd
        if (Test-Path $dest) {
            if ((Get-FileHash -Algorithm SHA256 $dest).Hash -eq (Get-FileHash -Algorithm SHA256 $src).Hash) {
                Remove-Item -LiteralPath $dest -Force
            } else {
                Write-Warning "Refusing to remove $dest (differs from current checkout). Remove manually if intended."
            }
        }
    }
}

function Install-ForgeCodeAgents {
    $base = Get-ForgeCodeBaseDir
    $target = Join-Path $base 'agents'
    $root = Get-ForgeCodeAgentsRoot

    if (-not (Test-Path $root)) {
        Write-Warning "ForgeCode agents not found in checkout: $root"
        Write-Warning 'If you are testing a fork/branch, set UA_REPO_URL and optionally UA_REPO_REF.'
        return
    }
    if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }

    foreach ($agent in Get-ForgeCodeAgentFiles) {
        $src = Join-Path $root $agent
        $dest = Join-Path $target $agent
        Copy-Item -LiteralPath $src -Destination $dest -Force
        Write-Host "  ✓ $dest ← $src"
    }
}

function Uninstall-ForgeCodeAgents {
    $base = Get-ForgeCodeBaseDir
    $target = Join-Path $base 'agents'
    $root = Get-ForgeCodeAgentsRoot

    if (-not (Test-Path $target)) { return }
    if (-not (Test-Path $root)) {
        Write-Warning "Agents checkout not found; remove copied agent files manually under: $target"
        return
    }

    foreach ($agent in Get-ForgeCodeAgentFiles) {
        $src = Join-Path $root $agent
        $dest = Join-Path $target $agent
        if (Test-Path $dest) {
            if ((Get-FileHash -Algorithm SHA256 $dest).Hash -eq (Get-FileHash -Algorithm SHA256 $src).Hash) {
                Remove-Item -LiteralPath $dest -Force
            } else {
                Write-Warning "Refusing to remove $dest (differs from current checkout). Remove manually if intended."
            }
        }
    }
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
        'copy-per-skill' {
            foreach ($skill in Get-SkillNames) {
                $dest = Join-Path $Target $skill
                $src  = Join-Path $root $skill

                if (Test-Path $dest) {
                    Remove-Item -LiteralPath $dest -Recurse -Force
                }

                Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
                Write-Host "  ✓ $dest ← $src"
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
        'copy-per-skill' {
            $skillsRoot = Get-SkillsRoot
            if (Test-Path $skillsRoot) {
                foreach ($skill in Get-SkillNames) {
                    $dest = Join-Path $Target $skill
                    $srcSkill = Join-Path (Join-Path $skillsRoot $skill) 'SKILL.md'
                    $destSkill = Join-Path $dest 'SKILL.md'

                    if (Test-Path $dest) {
                        if ((Test-Path $destSkill) -and (Test-Path $srcSkill) -and ((Get-FileHash -Algorithm SHA256 $destSkill).Hash -eq (Get-FileHash -Algorithm SHA256 $srcSkill).Hash)) {
                            Remove-Item -LiteralPath $dest -Recurse -Force
                        } else {
                            Write-Warning "Refusing to remove $dest (SKILL.md differs from current checkout). Remove manually if intended."
                        }
                    }
                }
            } else {
                Write-Warning "Skills checkout not found; remove copied skill directories manually under: $Target"
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

function Cmd-Install([string]$Id) {
    $cfg = Resolve-Platform $Id
    $target = Resolve-TargetDir $Id $cfg.Target
    Clone-Or-Update
    Write-Host "→ Linking skills for $Id ($($cfg.Style) → $target)"
    Link-Skills $target $cfg.Style

    if ($Id -eq 'forgecode') {
        Write-Host '→ Installing ForgeCode commands'
        Install-ForgeCodeCommands
        Write-Host '→ Installing ForgeCode agents'
        Install-ForgeCodeAgents
    }

    Write-Host '→ Linking universal plugin root'
    Link-Plugin-Root

    Write-Host "`n✓ Installed Understand-Anything for $Id"
    Write-Host '  Restart your CLI or IDE to pick up the skills.'
    if ($Id -eq 'vscode') {
        Write-Host "`n  Tip: VS Code can also auto-discover the plugin by opening this repo"
        Write-Host '       directly (it reads .copilot-plugin/plugin.json), no symlinks needed.'
    }
}

function Cmd-Uninstall([string]$Id) {
    $cfg = Resolve-Platform $Id
    $target = Resolve-TargetDir $Id $cfg.Target
    Write-Host "→ Removing skill links for $Id"
    Unlink-Skills $target $cfg.Style

    if ($Id -eq 'forgecode') {
        Write-Host '→ Removing ForgeCode command files'
        Uninstall-ForgeCodeCommands
        Write-Host '→ Removing ForgeCode agent files'
        Uninstall-ForgeCodeAgents
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
