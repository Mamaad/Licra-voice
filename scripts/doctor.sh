#!/usr/bin/env bash
set -uo pipefail
failures=0
check(){ local title=$1; shift; if "$@"; then printf 'OK %s\n' "$title"; else printf 'ÉCHEC %s\n' "$title"; failures=$((failures+1)); fi; }
check 'Ubuntu 24.04' bash -c 'source /etc/os-release; [[ $ID == ubuntu && $VERSION_ID == 24.04 ]]'
check 'x86_64' test "$(uname -m)" = x86_64
check 'non-root' test "$EUID" != 0
check 'serveur installé' test -x "$HOME/.local/bin/licra-server"
check 'LiveKit installé' test -x "$HOME/.local/bin/livekit-server"
check 'configuration privée' bash -c '[[ $(stat -c %a "$HOME/.config/licra/config.toml" 2>/dev/null) == 600 ]]'
check 'database privée' bash -c '[[ $(stat -c %a "$HOME/.local/share/licra/licra.db" 2>/dev/null) == 600 ]]'
check 'configuration et SQLite valides' "$HOME/.local/bin/licra-server" doctor
check 'systemd utilisateur' systemctl --user is-active licra-server.service licra-livekit.service
check 'linger' bash -c '[[ $(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null) == yes ]]'
check 'processus utilisateur' pgrep -u "$(id -u)" -f licra-server
mapfile -t ports < <("$HOME/.local/bin/licra-server" ports 2>/dev/null)
if [[ ${#ports[@]} -eq 3 ]]; then
  for index in 0 1 2; do protocol=tcp; [[ $index == 1 ]] && protocol=udp; echo "Écoute $protocol ${ports[$index]} :"; ss -lnupat 2>/dev/null | awk -v port=":${ports[$index]}" '$5 ~ (port "$") {print;found=1} END{exit !found}'; done
  check 'health locale' curl -fsS --max-time 5 "http://127.0.0.1:${ports[0]}/health"
fi
check 'LiveKit répond localement' "$HOME/.local/bin/licra-server" media-health
echo 'Adresses locales :'; hostname -I
if command -v curl >/dev/null; then printf 'IP publique (service externe api.ipify.org) : '; curl -fsS --max-time 3 https://api.ipify.org || true; echo; fi
echo "$failures problème(s). Les ports doivent aussi être ouverts chez le fournisseur/NAT ; un test local ne vérifie pas leur accès externe."
(( failures == 0 ))
