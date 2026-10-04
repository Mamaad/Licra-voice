#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID != 0 ]] || { echo "Exécuter sans sudo" >&2; exit 1; }
[[ $# == 2 && -f $1 && -f $2 ]] || { echo "Usage: update-server.sh licra-server checksums.txt" >&2; exit 1; }
binary=$(realpath "$1"); checksums=$(realpath "$2")
(cd "$(dirname "$binary")" && sha256sum --check "$checksums")
"$binary" --version
systemctl --user stop licra-server.service
trap 'systemctl --user start licra-server.service' EXIT
backup="$HOME/.local/state/licra/backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
cp -a "$HOME/.config/licra" "$backup/config"
# The control process is stopped, so SQLite DB/WAL/SHM are copied consistently.
cp -a "$HOME/.local/share/licra" "$backup/data"
cp "$HOME/.local/bin/licra-server" "$backup/licra-server"
install -m 755 "$binary" "$HOME/.local/bin/licra-server.next"
mv "$HOME/.local/bin/licra-server.next" "$HOME/.local/bin/licra-server"
systemctl --user start licra-server.service
sleep 2
port=$("$HOME/.local/bin/licra-server" ports | head -n1)
if ! curl -fsS --max-time 5 "${LICRA_HEALTH_URL:-http://127.0.0.1:$port/health}"; then
  systemctl --user stop licra-server.service
  cp "$backup/licra-server" "$HOME/.local/bin/licra-server"
  mv "$HOME/.local/share/licra" "$backup/failed-data"
  mkdir -p "$HOME/.local/share/licra"
  cp -a "$backup/data/." "$HOME/.local/share/licra/"
  echo "La nouvelle version ne répond pas. Binaire précédent restauré. Sauvegarde DB : $backup (ne jamais rétrograder le schéma sans restaurer cette sauvegarde)." >&2
  exit 1
fi
