# Rapport de phase — Licra 0.2.2

Projet existant conservé : design Licra, voix Opus, identité Ed25519/DPAPI,
permissions, salons, updater signé et installation serveur. Aucune nouvelle
dépendance runtime. Aucun nouveau port réseau.

## Résultat fonctionnel

Chat de salon et MP persistants, historique paginé, non lus, indicateurs de
saisie, réponses, édition et suppression logique. Le rendu est du texte Unicode
échappé ; les liens HTTP/HTTPS s’ouvrent dans le navigateur système. L’envoi par
Enter et les retours à la ligne Shift+Enter sont conservés avec protection IME.
Les MP restent liés à deux fingerprints du même serveur et sont accessibles
hors salon ; un destinataire déconnecté reçoit son historique à sa prochaine
connexion avec la même identité. Le texte est stocké par le serveur, sans E2EE.

Partages vidéo simultanés LiveKit : une source par utilisateur, quatre par
salon par défaut, grille, focus/épinglage, plein écran, indication dans l’arbre,
chat visible simultanément, arrêt personnel ou modération. Capture via le
sélecteur de plateforme ; Auto/1080p/1440p/Source, 30/60 FPS demandés,
contenu Auto/Texte/Mouvement. Source reste compressé et plafonné.

## Migration, permissions et protocole

Migration ajoutée : `server/migrations/002_chat.sql`. Tables `chat_peers`,
`chat_threads`, `chat_messages`, `chat_reads` ; index par thread/ID et date.
Application transactionnelle au démarrage, identités et tables existantes
conservées. Les nouveaux droits par défaut n’écrasent pas les règles présentes.

Permissions : `chat.channel.view`, `chat.channel.send`,
`chat.channel.history`, `chat.channel.edit_own`, `chat.channel.delete_own`,
`chat.channel.delete_others`, `chat.private.send`,
`chat.moderation.view_deleted`, `screen.share`, `screen.watch`,
`screen.stop_others`. DENY prime toujours sur ALLOW, même avec plusieurs rôles.

Commandes : `CHAT_OPEN`, `CHAT_HISTORY`, `CHAT_SEND`, `CHAT_EDIT`,
`CHAT_DELETE`, `CHAT_READ`, `CHAT_LIST`, `CHAT_TYPING`,
`SCREEN_START`, `SCREEN_JOIN`, `SCREEN_STOP`.
Événements : `CHAT_MESSAGE_CREATED/EDITED/DELETED`,
`PRIVATE_MESSAGE_CREATED/EDITED/DELETED`, `TYPING_STARTED/STOPPED`,
`CHAT_UNREAD`, `SCREEN_STATE`, `SCREEN_REVOKED`.
Le protocole reste v1, avec champs/capacités additionnels compatibles.

Contrats, configuration et politique complète : [chat-screen.md](chat-screen.md).

## Architecture et sécurité

Chat : contrôle WebSocket authentifié → serveur Go → SQLite WAL.
Auteur, pseudo mémorisé, salon, dates et accès sont contrôlés serveur.
Pagination de 50 lignes par curseur d’ID monotone, cache client limité à dix
conversations et mille messages par conversation. Typing non persisté et
limité ; quotas de messages, conversations, longueur, seconde/minute, édition
et rétention. Un seul curseur de lecture par identité/conversation.

Écran : capture/encodage client → LiveKit SFU → spectateurs autorisés.
Room écran `screen_<UUID>` distincte de la voix `channel_<UUID>` : refuser la
réception écran ne retire pas la réception vocale. Tokens courts liés au salon,
source `screen_share` seule, data et audio système interdits. L’API LiveKit
interne reste en loopback. Sortie, kick/ban et perte de droits révoquent les
sessions et ferment les tunnels. Le SFU ne compose ni ne transcode la vidéo.

Codecs : H.264 si MediaCapabilities annonce un encodeur compatible et économe
pour le profil demandé, VP8 sinon ; pas d’AV1/VP9 forcé. La validation locale
ci-dessous utilise réellement VP8 logiciel. H.264 matériel Windows n’a pas
été testé physiquement.

Simulcast réellement observé : trois encodages dans les statistiques RTP,
640 px, 1280 px et résolution source. Dynacast et adaptive stream sont activés
sur la room SDK ; les miniatures reçoivent une couche inférieure, le plein écran
une couche supérieure. La mesure `small_view_encodings` confirme `q.active=true` et
`h.active=false`, `f.active=false` : les couches inutilisées sont réellement
suspendues en miniature. Les encodages inactifs et dimensions reçues sont visibles
dans les diagnostics bruts ; la source synthétique 96×96 n’a qu’une couche.

## Mesures reproductibles

Commande : `npm run test:ui`, avec un vrai serveur Go/SQLite et LiveKit 1.13.7
isolés, SDK LiveKit JS 2.22.3, Chromium headless 153 et capture synthétique.
Machine Linux : Xeon E5-1620 v2 à 3,70 GHz, 8 processeurs logiques.
Mesures de quatre secondes après échauffement de deux secondes, voix active.
Un publisher et trois viewers, dont un en plein écran 3840×2160 et deux en
miniatures. 100 % CPU = un cœur. Les débits sont estimés depuis les compteurs
RTP vidéo ; ils n’incluent pas tout le trafic NIC/UDP/TCP/RTCP ni le trafic vocal.

| Profil | Résolution/FPS élevés observés | CPU SFU | RAM SFU | Upload publisher Mbit/s | Download par viewer Mbit/s | Sortie vidéo estimée SFU Mbit/s | Temps d’encodage publisher / durée |
|---|---|---:|---:|---:|---:|---:|---:|
| 1080p / 30 demandés | 1920×1080 / 20 | 9.9 % | 134 Mio | 1.29 | 0.15–0.70 | 1.01 | 79.1 % |
| 1080p / 60 demandés | 640×360 / 15 | 9.2 % | 144 Mio | 0.74 | 0.20–0.21 | 0.61 | 4.9 % |
| 1440p / 30 demandés | 2560×1440 / 21 | 11.3 % | 149 Mio | 2.11 | 0.16–0.93 | 1.25 | 72.1 % |
| 1440p / 60 demandés | 2560×1440 / 21 | 11.9 % | 151 Mio | 2.76 | 0.21–1.48 | 1.91 | 89.5 % |
| source / 30 demandés | 96×96 / 19 | 7.7 % | 155 Mio | 0.04 | 0.04–0.04 | 0.11 | 0.0 % |

Le temps d’encodage provient de `totalEncodeTime` ; ce n’est pas une mesure de
tout le processus publisher. Chromium complet, publisher et trois viewers
inclus, consomme environ 282–538 %
d’un cœur avec le rendu logiciel. Le GPU n’est pas observable dans cet essai.

Deux publishers + deux viewers : CPU SFU 9.4 %,
RAM 124 Mio, uploads respectifs
0.16/0.37 Mbit/s,
downloads 0.30/0.31 Mbit/s.
Les deux viewers reçoivent effectivement des images des deux publications.
La charge SFU reste faible dans ces scénarios ; aucune conclusion de capacité
Internet ou de maximum d’utilisateurs ne découle de quatre clients locaux.

Données complètes : [screen-local.json](benchmarks/screen-local.json).

Le profil 1080p60 a été réduit à une couche inférieure pendant cette mesure
(`qualityLimitationReason=bandwidth`) : les dimensions de la table sont celles
effectivement encodées, distinctes du profil demandé.

**60 FPS n’est pas validé physiquement** : la source synthétique plafonne
vers 20 FPS pour 1080p/1440p malgré les contraintes 30/60. Source est une
source de test native 96×96, et ne valide pas un moniteur Windows 4K.

## Tests et régressions corrigées

- `go test -race ./...` : migrations idempotentes, auteur/date imposés, pagination,
  pseudo mémorisé, MP canoniques/hors salon/offline, redémarrage, édition,
  suppression/citations, accès d’un tiers refusé, bans, rates, rétention et quota.
- Tests JWT écran : room/source, refus de publication/réception, quota, révocation.
- Test proxy : annulation d’un tunnel face à un client WebSocket muet, sans attente
  indéfinie. Analyse Go `go vet` et compilation serveur Linux.
- `npm run test:ui` : vraie UI/control/SQLite/LiveKit ; chat hostile/XSS et schémas
  dangereux refusés, messages modifiés/supprimés, MP offline/reconnexion,
  deux publishers/deux viewers, un publisher/trois viewers, arrivants pendant
  partage, simulcast, focus/fullscreen, chat pendant partage, révocation/restauration,
  transport coupé puis reconnexion automatique, modération et changement de salon.
- `npm run test:media` : Opus réellement reçu, rooms isolées, déplacement admin,
  ancien token refusé, périphériques/seuil micro/aperçu/parole après options.
- Client TypeScript/Vite et tests des adresses ; tests Rust d’identité et backup ;
  compilation croisée Windows GNU. La CI existante construit également Windows
  MSVC et le setup NSIS signé, vérifie la signature et l’installation/mise à jour
  sur un second disque avec conservation AppData.
- Affichages 1000/1100/1440/1920/3840 px, glisser-déposer, rôles, volume, favoris,
  statistiques vocales et bouton updater toujours couverts.

Corrections spécifiques : bitrate simulcast arrondi en entier (le protocole
LiveKit refuse les décimales) ; callbacks d’une ancienne room ignorés ; reprise
après annulation d’un join pendant une modification de droits ; fermeture des
deux côtés du proxy pour éviter le blocage du contrôle lors d’une coupure ;
retries conservés pour une ancienne session de la même identité ; lecture des
MP après retrait du droit d’envoi ; quota recalculé après cascade de suppression
de salon ; position de lecture conservée sur pagination ; double envoi bloqué ;
indicateurs de saisie bornés au cache de conversations.

La version 0.2.0 taguée initialement a été bloquée par le contrôle de cohérence
avant publication : le fichier de version Tauri n’était pas inclus dans le
commit. La version 0.2.1 a ensuite révélé une collision de modules sur Windows :
`Chat.tsx` et `chat.ts`. Le composant s’appelle désormais `ChatPanel.tsx` et
un test vérifie les noms de modules indépendamment de la casse.
La livraison 0.2.2 corrige ces deux problèmes ; les fonctionnalités et la
migration restent identiques aux mesures locales précédentes.

## Limites et livraison

Le sélecteur moniteur/fenêtre WebView2, les GPU et encodeurs H.264 physiques,
60 FPS réels et la concurrence voix/vidéo sur une liaison Internet saturée
restent à tester sur Windows. La priorité vidéo est basse ; les connexions
séparées n’offrent pas une réservation commune garantie de bande passante.

Les plafonds bitrate/FPS sont appliqués par le client officiel. Source, nombre
et dimensions des pistes sont surveillés serveur toutes les dix secondes ;
ce n’est pas un policier de trafic par participant pour un client modifié.
`history_enabled=false` masque l’historique et garde le dernier message par
conversation ; cela ne garantit pas zéro stockage. Le serveur peut lire les MP.
Aucun Markdown, upload, webcam, audio système, YouTube, navigateur ou tableau blanc.

Les builds officiels sont distribués via [la release 0.2.2](https://github.com/Mamaad/Licra-voice/releases/tag/v0.2.2)
et l’updater signé existant. Le client peut se connecter à un ancien serveur ;
les nouvelles fonctions nécessitent le serveur 0.2.2. Aucun port supplémentaire.
La migration et le redémarrage du serveur de production doivent être autorisés
avant installation ; les tests ci-dessus utilisent un serveur isolé.

## Fichiers modifiés/ajoutés

Les principaux ajouts sont `chat.go`, `screen.go`, la migration 002,
`ChatPanel.tsx`, `chat.ts`, `Screens.tsx`, `screen.ts` et les scénarios de tests.
Les autres modifications étendent les points d’entrée existants, types,
permissions, IPC natif, versions et documentation. Liste complète :

- `CLIENT_VERSION`
- `README.md`
- `RELEASE_NOTES.md`
- `SERVER_VERSION`
- `client/package-lock.json`
- `client/package.json`
- `client/src-tauri/Cargo.lock`
- `client/src-tauri/Cargo.toml`
- `client/src-tauri/capabilities/default.json`
- `client/src-tauri/src/main.rs`
- `client/src-tauri/tauri.conf.json`
- `client/src/Admin.tsx`
- `client/src/App.tsx`
- `client/src/ChatPanel.tsx`
- `client/src/Screens.tsx`
- `client/src/Shell.tsx`
- `client/src/chat.ts`
- `client/src/control.ts`
- `client/src/permissions.ts`
- `client/src/screen.ts`
- `client/src/style.css`
- `client/src/types.ts`
- `client/src/ui.tsx`
- `client/src/version.ts`
- `client/src/voice.ts`
- `client/tests/ui.html`
- `docs/architecture.md`
- `docs/benchmarks/media-local.json`
- `docs/benchmarks/screen-local.json`
- `docs/chat-screen.md`
- `docs/performance.md`
- `docs/permissions.md`
- `docs/phase-chat-screen-report.md`
- `docs/protocol.md`
- `docs/screenshots/core/audio-1440.png`
- `docs/screenshots/core/channel-1000.png`
- `docs/screenshots/core/channel-1100.png`
- `docs/screenshots/core/channel-1440.png`
- `docs/screenshots/core/channel-1920.png`
- `docs/screenshots/core/channel-3840.png`
- `docs/screenshots/core/chat-private-1440.png`
- `docs/screenshots/core/context-1440.png`
- `docs/screenshots/core/permissions-1000.png`
- `docs/screenshots/core/permissions-1100.png`
- `docs/screenshots/core/permissions-1440.png`
- `docs/screenshots/core/permissions-1920.png`
- `docs/screenshots/core/permissions-3840.png`
- `docs/screenshots/core/screens-chat-1440.png`
- `docs/screenshots/core/server-1440.png`
- `docs/screenshots/core/voice-statistics-1440.png`
- `docs/security.md`
- `docs/validation.md`
- `server/internal/config/config.go`
- `server/internal/control/chat.go`
- `server/internal/control/chat_test.go`
- `server/internal/control/model.go`
- `server/internal/control/moderation.go`
- `server/internal/control/operations.go`
- `server/internal/control/screen.go`
- `server/internal/control/server.go`
- `server/internal/control/server_test.go`
- `server/internal/control/voice.go`
- `server/internal/media/livekit.go`
- `server/internal/permissions/names_gen.go`
- `server/internal/protocol/version_gen.go`
- `server/internal/store/store_test.go`
- `server/migrations/002_chat.sql`
- `shared/protocol/v1.schema.json`
- `tools/ui-check/run.mjs`

Fichier de test ajouté : `client/tests/module-names.test.mjs`.
