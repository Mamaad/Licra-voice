# Licra Voice

Client vocal Windows et serveur auto-hébergé Ubuntu, sans compte central,
avec chat persistant et partage d’écran.
Tauri v2, React/TypeScript, Go, SQLite et LiveKit SFU. Licence MIT ; LiveKit
est distribué séparément sous sa propre licence Apache 2.0.

## Démarrage rapide

Depuis le bundle serveur Linux x86_64 de [GitHub Releases](https://github.com/Mamaad/Licra-voice/releases) :

```bash
tar -xzf licra-server-linux-x86_64.tar.gz
cd licra
./start.sh
~/.local/bin/licra-server admin-token
```

Exécuter sous un utilisateur normal. Ouvrir `64738/TCP`, `64739/UDP`,
`64740/TCP`. Pour un autre port initial : `BASE_PORT=25000 ./scripts/install-server.sh`.
L’installateur conserve une configuration existante. `./start.sh` installe si
nécessaire puis active les deux services avec redémarrage en cas de panne.
`./stop.sh` les arrête et désactive leur démarrage automatique en conservant
les données ; `./start.sh` le réactive. Les scripts se lancent sans sudo. Aucun Docker ni Redis.
`systemd --user` démarre deux services ; le boot sans session requiert
`Linger=yes`, que seul un administrateur système peut activer.

Sur Windows 10/11 x86_64, installer le `Licra_*_x64-setup.exe` officiel,
ouvrir Licra, saisir `IP:64738` et un pseudo. Double-cliquer sur un salon
pour rejoindre. Le bouton « Réclamer le rôle Owner » accepte le bootstrap
token. Le premier client n’est jamais administrateur automatiquement.
L’identité locale est protégée par Windows DPAPI ; exporter une sauvegarde
chiffrée avant de changer de PC. Installation per-user dans LocalAppData.

## Développement

Prérequis : Go 1.27.1, Node 22+, Rust stable. Windows : MSVC Build Tools et
WebView2. Le serveur Linux est compilé sans CGO.

```bash
cd server
go test -race ./...
go build -o ../bin/licra-server ./cmd/licra-server
../bin/licra-server --config /tmp/licra/config.toml init-config
# Démarrer LiveKit avec /tmp/licra/livekit.yaml dans un autre terminal.
../bin/licra-server --config /tmp/licra/config.toml
```

```bash
cd client
npm ci
npm test
npm run build
npm run tauri dev
```

Les clés de signature de release restent hors du dépôt. La CI génère les
installateurs NSIS signés et `latest.json`. L’updater officiel vérifie les
signatures et demande un clic avant installation.

## Documentation

- [Architecture](docs/architecture.md) et [protocole](docs/protocol.md)
- [Permissions et scopes](docs/permissions.md)
- [Installation serveur](docs/server-install.md), [build client](docs/client-build.md)
- [Releases](docs/releasing.md), [sécurité](docs/security.md)
- [Dépannage](docs/troubleshooting.md), [validation et limites](docs/validation.md)
- [Performance](docs/performance.md)
- [Chat et partage d’écran](docs/chat-screen.md), [rapport 0.2.0](docs/phase-chat-screen-report.md)

La validation locale et la validation sur Windows sont consignées dans
`docs/validation.md`. Ne pas déduire une capacité réseau de production d’un
benchmark du control plane. La version 0.2.0 ajoute le chat persistant
et le partage d’écran LiveKit. Fichiers, YouTube, navigateur collaboratif,
webcam et tableau blanc restent différés.
