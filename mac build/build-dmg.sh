#!/usr/bin/env bash
# Builds Cinemuah-<version>-<arch>.dmg. Must run on a Mac (the DMG tooling needs macOS).
# Usage: ./"mac build"/build-dmg.sh [x64|arm64]   (default: this Mac's architecture)
set -euo pipefail
cd "$(dirname "$0")/.."
ARCH="${1:-$(uname -m | sed 's/x86_64/x64/')}"
npm ci
npm run build
npx electron-builder --mac dmg --"$ARCH" --config "mac build/electron-builder.mac.json" --publish never
echo "Done: release-mac/"
ls release-mac/*.dmg
