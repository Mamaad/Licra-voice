# Releases officielles

Dépôt officiel : https://github.com/Mamaad/Licra-voice.
Endpoint updater : `https://github.com/Mamaad/Licra-voice/releases/latest/download/latest.json`.
Le dépôt doit être public pour que les utilisateurs sans compte téléchargent
les releases. Aucun serveur auto-hébergé ne contrôle cet endpoint.

La clé publique est dans `packaging/updater.pub` et tauri.conf.json. La clé
privée et sa passphrase ne sont jamais commitées et ne vont pas dans un bundle
serveur. Dans cette installation de développement, elles sont protégées hors
du repo sous `~/.local/share/licra-release/`. Sauvegarder ces fichiers dans un
coffre personnel : une perte bloque les mises à jour des clients déjà installés.

Secrets GitHub Actions requis : `TAURI_SIGNING_PRIVATE_KEY` (contenu complet
clé privée Tauri) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (passphrase).
Le workflow Windows ne les lit que pour la build de release, jamais pour une PR.

1. Éditer CLIENT_VERSION, SERVER_VERSION, package.json, Cargo.toml,
   tauri.conf.json et RELEASE_NOTES.md.
2. `python3 scripts/generate-protocol.py`; `python3 scripts/check-versions.py`.
3. Refaire les tests, vérifier les critères Windows décrits dans validation.md.
4. Pousser un tag `v0.1.0` correspondant aux versions. Le workflow compile
   serveur Linux et client NSIS Windows, signe le setup et génère latest.json.
5. Le job publish crée la release et charge les assets. Les builds doivent
   toutes réussir avant publication. Un artifact sans `.sig` n’est pas publiable.

Le plugin vérifie les updates au démarrage puis toutes les 6 heures. Il présente
les notes, « Plus tard » et « Télécharger et installer », avec progression.
Signature obligatoire, installation passive per-user, relance. Un serveur
qui refuse une ancienne version déclenche aussi une vérification d’update.
La clé updater n’est pas un certificat Authenticode : Windows peut afficher
SmartScreen pour un éditeur non reconnu, malgré une signature updater valide.

[Updater officiel Tauri](https://v2.tauri.app/plugin/updater/)
et [installer Windows](https://v2.tauri.app/distribute/windows-installer/).
