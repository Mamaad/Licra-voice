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
- Installation Linux non-root sur ce poste : services systemd utilisateur,
  health, diagnostics SQLite, redémarrage et désinstallation avec conservation
  de la configuration et de la base ; migrations concurrentes testées.
- Charge control plane locale : 50 sessions, résultats JSON conservés.
- Régressions audio 0.1.1 : le vrai module client est exercé avec un signal
  PCM connu, sans permission caméra ; vérification du seuil qui coupe/réactive
  la publication, du niveau micro et de l’indicateur après modification des
  options et fermeture de la prévisualisation.
- Test média réel : `npm ci` à la racine, `npx playwright install chromium`,
  `npm run test:media`. Il lance LiveKit officiel et trois clients WebRTC avec
  microphones synthétiques ; vérifie Opus, rooms distinctes, déplacement admin
  et refus d’un ancien credential média. Ce test passe ; voir `benchmarks/media-local.json`.

Refonte CORE 0.1.2 :

- `npm run test:ui` à la racine lance un serveur et LiveKit isolés sur les ports
  27438–27441, puis le vrai client React/control/audio dans Chromium. Seule
  l’API native Tauri est remplacée pour signer l’identité avec WebCrypto.
- Connexion signée, favoris, création de salons, rôles et décisions de permissions,
  volume individuel/général, seuil micro et visibilité des commandes pour un invité.
- Signal PCM réel pour vérifier le niveau micro et l’indicateur vocal.
- Mise à jour : bouton et état « à jour » vérifiés avec l’API native de test ;
  le téléchargement/installateur signé reste vérifié séparément dans la CI Windows.
- Dimensions 1000, 1100, 1440, 1920 et 3840 px : barre audio accessible,
  absence de débordement horizontal et fenêtres de paramètres dans le viewport.
- Captures dans `docs/screenshots/core/`. Les données viennent du serveur isolé ;
  aucun faux état ou périphérique n’est inclus dans le bundle de production.
- Aucun mode Ultra Low Latency ; profils Opus existants et diagnostics réels.

Version 0.1.3 :

- Glisser-déposer : déplacement d’un invité par Owner depuis la liste et l’arbre,
  déplacement de soi-même, ordre des salons, changement de parent, refus des
  cycles et commandes indisponibles pour les invités sans permission d’édition.
- Un changement d’ordre ne produit aucun événement `VOICE_REJOIN_REQUIRED`.
- Clic « Connecté » : mesures WebRTC réelles, paquets reçus et débits dans la
  fenêtre de statistiques ; capture `core/voice-statistics-1440.png`.
- CI Windows : installation sur un disque secondaire dans un chemin avec espaces,
  mise à jour `/UPDATE` conservant ce chemin et données AppData préservées.
- L’identité et les paramètres restent dans le profil Windows ; choisir un autre
  disque pour le programme ne déplace pas AppData.

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

## Phase 0.2.0 — chat et partage d’écran

La suite complète locale Go/SQLite/LiveKit/React passe, y compris perte réseau,
reconnexion et voix pendant partage. Détail des commandes, profils réellement
observés, limites Windows et mesures :
[rapport de phase](phase-chat-screen-report.md).
