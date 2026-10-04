#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$ROOT/bin"
temp=$(mktemp -d); trap 'rm -rf "$temp"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 https://github.com/livekit/livekit/releases/download/v1.13.7/livekit_1.13.7_linux_amd64.tar.gz -o "$temp/livekit.tar.gz"
printf '%s  %s\n' '6634aeeb2fb1366b6723708ae4320b9d5408106a4c63457c5e845ae3979c90e2' "$temp/livekit.tar.gz" | sha256sum --check --status
tar -xzf "$temp/livekit.tar.gz" -C "$temp"
install -m 755 "$temp/livekit-server" "$ROOT/bin/livekit-server"
if [[ -f $temp/LICENSE ]]; then install -m 644 "$temp/LICENSE" "$ROOT/bin/LICENSE-livekit"; fi
