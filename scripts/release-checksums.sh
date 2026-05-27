#!/usr/bin/env bash
# release-checksums.sh — Emit SHA256SUMS for the install scripts at release time.
#
# Usage (from repo root, on the release commit):
#   ./scripts/release-checksums.sh > SHA256SUMS
#   git add SHA256SUMS && git commit -m "chore: SHA256SUMS for $(git describe --tags --abbrev=0)"
#
# Users verify the curl-piped installer against this file:
#   curl -fsSLO https://raw.githubusercontent.com/Lum1104/Understand-Anything/<TAG>/install.sh
#   curl -fsSL  https://raw.githubusercontent.com/Lum1104/Understand-Anything/<TAG>/SHA256SUMS | sha256sum -c -
#   bash ./install.sh
#
# Why: pinning curl|bash to /main/ means any compromise of main runs on every
# user's machine. Pinning to an immutable tag + a checksum closes that gap.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Files we attest. Keep this list short — anything here MUST be present in the
# repo at the release commit, and the README must reference the same paths.
FILES=(
  install.sh
  install.ps1
)

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    printf 'release-checksums: missing %s\n' "$f" >&2
    exit 1
  fi
done

# Portable: prefer `sha256sum` (Linux, Git Bash), fall back to `shasum -a 256` (macOS).
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${FILES[@]}"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${FILES[@]}"
else
  printf 'release-checksums: neither sha256sum nor shasum found\n' >&2
  exit 1
fi
