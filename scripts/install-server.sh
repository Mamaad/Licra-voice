#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $EUID == 0 ]]; then echo "Installer sous un utilisateur Linux normal, sans sudo." >&2; exit 1; fi
if [[ $(uname -m) != x86_64 ]]; then echo "Ubuntu x86_64 requis." >&2; exit 1; fi
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
BASE_PORT=${BASE_PORT:-64738}
[[ $BASE_PORT =~ ^[0-9]+$ ]] && (( BASE_PORT >= 1024 && BASE_PORT <= 65533 )) || { echo "BASE_PORT invalide" >&2; exit 1; }
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/licra" "$HOME/.local/state/licra" "$HOME/.config/licra" "$HOME/.config/systemd/user"
SERVER_BINARY="$ROOT/bin/licra-server"
if [[ ! -x $SERVER_BINARY ]]; then
  command -v go >/dev/null || { echo "Télécharger le bundle serveur Linux contenant bin/licra-server, ou compiler avec Go." >&2; exit 1; }
  (cd "$ROOT/server" && go build -trimpath -o "$SERVER_BINARY" ./cmd/licra-server)
fi
install -m 755 "$SERVER_BINARY" "$HOME/.local/bin/licra-server"
if [[ -x $ROOT/bin/livekit-server ]]; then
  install -m 755 "$ROOT/bin/livekit-server" "$HOME/.local/bin/livekit-server"
else
  command -v curl >/dev/null || { echo "curl requis pour télécharger LiveKit" >&2; exit 1; }
  temp=$(mktemp -d); trap 'rm -rf "$temp"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 https://github.com/livekit/livekit/releases/download/v1.13.7/livekit_1.13.7_linux_amd64.tar.gz -o "$temp/livekit.tar.gz"
  printf '%s  %s\n' '6634aeeb2fb1366b6723708ae4320b9d5408106a4c63457c5e845ae3979c90e2' "$temp/livekit.tar.gz" | sha256sum --check --status
  tar -xzf "$temp/livekit.tar.gz" -C "$temp" livekit-server
  install -m 755 "$temp/livekit-server" "$HOME/.local/bin/livekit-server"
fi
if [[ ! -f $HOME/.config/licra/config.toml ]]; then
  "$HOME/.local/bin/licra-server" --config "$HOME/.config/licra/config.toml" --base-port "$BASE_PORT" init-config
else
  "$HOME/.local/bin/licra-server" --config "$HOME/.config/licra/config.toml" init-config
  BASE_PORT=$("$HOME/.local/bin/licra-server" --config "$HOME/.config/licra/config.toml" ports | head -n1)
fi
install -m 600 "$ROOT/packaging/linux/licra-livekit.service" "$HOME/.config/systemd/user/licra-livekit.service"
install -m 600 "$ROOT/packaging/linux/licra-server.service" "$HOME/.config/systemd/user/licra-server.service"
if systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable licra-livekit.service licra-server.service
  systemctl --user start licra-server.service
else
  echo "systemd --user indisponible dans cette session. Pour démarrer sans root :"
  echo "~/.local/bin/livekit-server --config ~/.config/licra/livekit.yaml"
  echo "~/.local/bin/licra-server --config ~/.config/licra/config.toml"
fi
if [[ $(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true) != yes ]]; then
  echo "Linger=no : le démarrage au boot et le fonctionnement après déconnexion ne sont pas garantis."
  echo "Un administrateur peut activer : sudo loginctl enable-linger $(id -un)"
fi
echo "Ports à ouvrir (pare-feu inchangé) : $BASE_PORT/TCP, $((BASE_PORT+1))/UDP, $((BASE_PORT+2))/TCP."
echo "Si vous choisissez d’utiliser UFW : sudo ufw allow $BASE_PORT/tcp ; sudo ufw allow $((BASE_PORT+1))/udp ; sudo ufw allow $((BASE_PORT+2))/tcp"
echo "Adresse à communiquer : IP_PUBLIQUE:$BASE_PORT"
echo "Owner : ~/.local/bin/licra-server admin-token"
