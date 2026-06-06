<#
.SYNOPSIS
  Build tree-sitter-pascal.wasm using Docker + Emscripten.

.DESCRIPTION
  The resulting WASM is placed inside the installed package so web-tree-sitter
  can load it via require.resolve().

.NOTES
  Prerequisites: Docker daemon running with Emscripten image available.
  Run 'pnpm install' inside understand-anything-plugin/ before this script.
#>

$ErrorActionPreference = 'Stop'

$ScriptDir   = $PSScriptRoot
$PluginDir   = Join-Path $ScriptDir '..\understand-anything-plugin'
$GrammarDir  = Join-Path $PluginDir 'node_modules\tree-sitter-pascal'

if (-not (Test-Path $GrammarDir)) {
    Write-Error "tree-sitter-pascal not found at $GrammarDir`nRun 'pnpm install' inside understand-anything-plugin/ first."
}

$GrammarDirAbs = (Resolve-Path $GrammarDir).Path
$OutFile = Join-Path $GrammarDirAbs 'tree-sitter-pascal.wasm'

Write-Host "→ Building tree-sitter-pascal.wasm..."
docker run --rm `
    -v "${GrammarDirAbs}:/src" `
    -w /src `
    emscripten/emsdk `
    emcc src/parser.c `
        -o tree-sitter-pascal.wasm `
        -Os `
        -s WASM=1 `
        -s SIDE_MODULE=1 `
        "-s EXPORTED_FUNCTIONS=['_tree_sitter_pascal']" `
        -fvisibility=hidden `
        -I./src

Write-Host "✓ Built: $OutFile"
