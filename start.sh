#!/usr/bin/env bash
set -euo pipefail
[[ $EUID != 0 ]] || { echo "Lancer sans sudo, sous l’utilisateur propriétaire de Licra." >&2; exit 1; }
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
systemctl --user show-environment >/dev/null 2>&1 || {
  echo "systemd utilisateur indisponible : lancer depuis une session de l’utilisateur Linux propriétaire." >&2
  exit 1
}
if [[ ! -x $HOME/.local/bin/licra-server || ! -x $HOME/.local/bin/livekit-server || ! -f $HOME/.config/licra/config.toml || ! -f $HOME/.config/systemd/user/licra-server.service || ! -f $HOME/.config/systemd/user/licra-livekit.service ]]; then
  "$ROOT/scripts/install-server.sh"
fi
systemctl --user daemon-reload
systemctl --user reset-failed licra-livekit.service licra-server.service
systemctl --user enable licra-livekit.service licra-server.service
systemctl --user start licra-livekit.service licra-server.service
systemctl --user is-active licra-livekit.service licra-server.service
mapfile -t ports < <("$HOME/.local/bin/licra-server" ports)
printf 'Connexion : IP_DU_SERVEUR:%s\nPorts à ouvrir : %s/TCP, %s/UDP, %s/TCP\n' "${ports[0]}" "${ports[0]}" "${ports[1]}" "${ports[2]}"
echo 'Logs : journalctl --user -u licra-server -u licra-livekit -f'
if [[ $(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true) != yes ]]; then
  echo "Pour fonctionner après déconnexion et au boot, un administrateur doit exécuter : sudo loginctl enable-linger $(id -un)"
fi
