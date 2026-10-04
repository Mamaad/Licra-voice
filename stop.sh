#!/usr/bin/env bash
set -euo pipefail
[[ $EUID != 0 ]] || { echo "Lancer sans sudo, sous l’utilisateur propriétaire de Licra." >&2; exit 1; }
# Disable both so an intentional stop also survives the next boot.
systemctl --user disable --now licra-server.service licra-livekit.service
echo 'Licra arrêté ; configuration, identité administrateur et base conservées.'
echo 'Relancer start.sh pour réactiver le démarrage automatique.'
