#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
OUT_BASE="../extension/zeropr/bin"

build() {
  local vsce_target="$1" goos="$2" goarch="$3" ext="${4:-}"
  local dir="$OUT_BASE/$vsce_target"
  mkdir -p "$dir"
  echo "building $vsce_target ($goos/$goarch)..."
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
    go build -ldflags="-s -w" -o "$dir/zeropr-agent$ext" .
}

build darwin-arm64  darwin  arm64
build darwin-x64    darwin  amd64
build linux-x64     linux   amd64
build linux-arm64   linux   arm64
build win32-x64     windows amd64 .exe

echo "done."
