#!/usr/bin/env bash
set -euo pipefail
[[ $EUID != 0 ]] || { echo "Exécuter sans sudo" >&2; exit 1; }
systemctl --user disable --now licra-server.service licra-livekit.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/licra-server.service" "$HOME/.config/systemd/user/licra-livekit.service" "$HOME/.local/bin/licra-server" "$HOME/.local/bin/livekit-server"
systemctl --user daemon-reload 2>/dev/null || true
if [[ ${1:-} == --purge ]]; then
  read -r -p 'Supprimer définitivement configuration, salons, permissions et bootstrap ? [oui/N] ' answer
  if [[ $answer == oui ]]; then rm -rf "$HOME/.config/licra" "$HOME/.local/share/licra" "$HOME/.local/state/licra"; fi
else
  echo "Configuration et base conservées. --purge permet une suppression confirmée."
fi
