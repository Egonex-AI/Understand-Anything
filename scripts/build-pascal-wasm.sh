#!/usr/bin/env bash
# Build tree-sitter-pascal.wasm using Docker + Emscripten.
# The resulting WASM is placed inside the installed package so web-tree-sitter
# can load it via require.resolve().
#
# Prerequisites: Docker daemon running with Emscripten image available.
# Usage: bash scripts/build-pascal-wasm.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/../understand-anything-plugin"
GRAMMAR_DIR="$PLUGIN_DIR/node_modules/tree-sitter-pascal"

if [[ ! -d "$GRAMMAR_DIR" ]]; then
  echo "Error: tree-sitter-pascal not found at $GRAMMAR_DIR"
  echo "Run 'pnpm install' inside understand-anything-plugin/ first."
  exit 1
fi

OUT_FILE="$GRAMMAR_DIR/tree-sitter-pascal.wasm"

echo "→ Building tree-sitter-pascal.wasm..."
docker run --rm \
  -v "$GRAMMAR_DIR:/src" \
  -w /src \
  emscripten/emsdk \
  emcc src/parser.c \
    -o tree-sitter-pascal.wasm \
    -Os \
    -s WASM=1 \
    -s SIDE_MODULE=1 \
    -s "EXPORTED_FUNCTIONS=['_tree_sitter_pascal']" \
    -fvisibility=hidden \
    -I./src

echo "✓ Built: $OUT_FILE"
