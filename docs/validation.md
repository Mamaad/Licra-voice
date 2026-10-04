# Validation V1

Les tests automatisés ne remplacent pas la validation sur deux vrais postes
Windows et une Ubuntu fraîche accessible publiquement.

Vérifications locales effectuées :

- Go : configuration, migrations idempotentes, challenge/replay/expiry,
  compatibilité SemVer, résolution exhaustive ALLOW/DENY/INHERIT, héritage,
  scopes, bootstrap consommé, protection dernier Owner, salons/cycles,
  connexion WS simulée, permissions refusées, déplacement, kick, ban,
  génération/expiration tokens LiveKit et révocation d’accès.
- `go test -race ./...` et build du serveur ; détails exacts dans les sorties CI.
- TypeScript/React : `npm run build`, tests de parsing IP/hostname/TLS/IPv6.
- Rust : export/import AES-GCM/Argon2, mauvaise passphrase et persistance
  de l’identité ; tests natifs Windows et compilation Tauri réussis en CI.
- Signature de l’installateur : vérifiée avec le même vérificateur que Tauri ;
  une copie altérée est refusée. Le workflow vérifie également installation
  par utilisateur, réinstallation en mode update et conservation des données
  lors d’une désinstallation silencieuse.
- Charge control plane locale : 50 sessions, résultats JSON conservés.
- Test média réel : `npm ci` à la racine, `npx playwright install chromium`,
  `npm run test:media`. Il lance LiveKit officiel et trois clients WebRTC avec
  microphones synthétiques ; vérifie Opus, rooms distinctes, déplacement admin
  et refus d’un ancien credential média. Ce test passe ; voir `benchmarks/media-local.json`.

À valider avant le statut « utilisable quotidiennement » :

1. Installer le bundle Linux sous un utilisateur d’une Ubuntu 24.04 fraîche,
   démarrage/logout/boot avec le linger documenté et ports publiquement accessibles.
2. Installer le NSIS sur deux PC Windows 10/11 sans UAC Licra, capture/sortie
   réelles, PTT hors focus, mute/deafen et volume 0–200 %.
3. Tester changements de salons, isolation audio, admin, bans et redémarrage
   avec conservation de salons/rôles/identités.
4. Publier une seconde release signée ; updater détecté depuis la première,
   notes, choix utilisateur, signature, installation et identité conservée.
5. Mesurer débit/CPU/latence/pertes audio sur le Xeon cible et réseau réel.

La CI Windows fournit un binaire natif et le workflow release un installateur
signé. Le scénario d’update entre deux releases et les microphones physiques
requièrent un environnement Windows et ne sont pas déclarés validés par une
simple compilation.
