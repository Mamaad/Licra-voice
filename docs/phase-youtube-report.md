# Rapport de phase — Licra 0.3.0

## Résultat et corrections

Projet existant conservé : voix Opus/LiveKit, identité Ed25519, salons, chat,
MP, permissions, design Licra, updater et installation Windows/AppData.
YouTube synchronisé est intégré au panneau central ; le chat reste accessible.
Volume/mute locaux, contrôles de salon et file sont distingués.

Le bouton plein écran entre et sort réellement du mode plein écran pour les
partages et pour un lecteur YouTube apparu après le montage du panneau.
Les caps de bitrate écran sont doublés ; cible 1080p30 8 Mbit/s, défaut serveur
16 Mbit/s. La bande passante effectivement envoyée reste adaptée par WebRTC.
Le plafond explicite d’un administrateur est conservé.

**Le bandeau « tauri.localhost partage une fenêtre » n’est pas retiré.**
WebView2 n’expose pas de contrôle stable de masquage de cet indicateur dans la
stack inspectée. La [demande Microsoft](https://github.com/MicrosoftEdge/WebView2Feedback/issues/2442)
reste ouverte ; `ScreenCaptureStarting` contrôle l’autorisation/la cancellation,
pas le texte ou l’affichage du bandeau d’une capture active. Aucun changement
d’origine, migration de réglages ni flag Chromium non documenté n’a été ajouté.

## Architecture et persistance

Client → lecteur officiel YouTube/CDN directement. Serveur Go → WebSocket
existant uniquement pour état et actions. Aucun proxy, téléchargement serveur,
transcodage, stream LiveKit YouTube, scraping, yt-dlp ou API key supplémentaire.

Migration 003 : table `youtube_activities`, état JSON borné par salon avec FK
cascade vers les salons. Données persistées : vidéo, play/pause/stop, position
et timestamp de référence, auteur, dernier contrôleur/pseudo, date, révision,
durée, file limitée et vingt vidéos précédentes. Au redémarrage, pause à la
référence persistée ; à l’arrêt normal, position courante persistée. La durée
de panne n’est pas ajoutée à la lecture.

Le serveur vérifie l’appartenance réelle au salon, les droits, révisions,
IDs/URLs, positions, indices, tailles et fréquences. Une échéance par activité
et révision peut décider la fin et la prochaine vidéo ; aucun tick permanent.
La durée provient du lecteur d’un client autorisé (auteur avec droit start, ou change_video), et n’est pas vérifiée par
une API serveur. Les événements périmés ne peuvent pas doubler un changement.

## Protocole et permissions

Commandes : `YOUTUBE_GET/START/PLAY/PAUSE/SEEK/STOP/NEXT/PREVIOUS`,
`YOUTUBE_DURATION/ENDED`, `YOUTUBE_QUEUE_ADD/REMOVE/MOVE/CLEAR`.
Événement : `YOUTUBE_STATE`. Snapshot : config et activité YouTube, `server_time`.
PONG fournit aussi `server_time`. Révisions croissantes, erreur `STALE_ACTIVITY`
avec nouvel état ; protocole v1 étendu de façon additive, capacité `youtube_sync`.

Permissions : `youtube.view`, `youtube.start`, `youtube.control`, `youtube.seek`,
`youtube.change_video`, `youtube.stop`, `youtube.queue_manage`.
Guest voit ; Member/Moderator/Administrator/Owner contrôlent par défaut.
Les permissions sont présentées en français dans l’éditeur actuel et les
anciennes règles ne sont pas écrasées. DENY reste prioritaire.

## Horloge, dérive, join et autoplay

Offset estimé = `server_time - (t_send + t_receive)/2`, meilleur RTT des huit
échantillons récents sur deux minutes. Mesure via l’horloge monotone du client
ancrée à `performance.timeOrigin`, pas son Date local comme autorité.
Position attendue = référence serveur + temps écoulé si PLAYING.

Observation locale toutes les secondes ; seek si dérive >1,25 s, espacement
périodique minimal de huit secondes. Événement serveur et activation manuelle
peuvent corriger immédiatement ; seuil de 250 ms en pause. Aucun changement
permanent de vitesse. Le RTT et l’offset restent des estimations, notamment sur
une liaison asymétrique. Diagnostics : dérive, RTT, offset, positions, révision.

Arrivants : snapshot/GET de l’activité canonique. Coupure involontaire : retour
au salon précédent avec son mot de passe gardé en mémoire, puis reconstruction
canonique. Déconnexion explicite : cette intention est effacée. Changement de
salon ou perte du droit de voir : destruction du player précédent.

Si autoplay est bloqué, un bouton active le lecteur depuis un geste utilisateur
et rejoint la position actuelle. Le volume et mute sont locaux et persistés,
sans commande play/pause globale. File : ajouter, supprimer, déplacer, vider,
suivante/précédente ; le serveur choisit le nouvel état.

## Tests et mesures

- Go `test -race ./...`, `go vet` et build Linux : migrations, canon temporel,
  dates/auteur imposés, formats de lien, URL hostile, isolation des salons,
  queue/indices, échéance de fin, persistance/restart, droits atomiques,
  révocation de visibilité, limites de fréquence et activité désactivée.
- TypeScript/Vite ; cinq tests Node (adresses, modules Windows, IDs YouTube,
  horloge et seuil de correction). Tests Rust identité/backup ; compilation
  croisée Windows GNU avec le hook Referer natif.
- `npm run test:media` : voix Opus réelle, déplacement/isolation des salons,
  ancien token refusé, périphériques, activation micro, aperçu et indicateur.
- `npm run test:ui` : toutes les régressions existantes chat/MP/XSS/roles/audio,
  écrans simultanés, profils 1080p/1440p/Source 30/60 demandés, changement de
  permissions, arrêt/modération, fullscreen entrée/sortie, layouts 1000–3840.
- YouTube dans cette UI : cinq vrais clients Go/WebSocket/SQLite et voix
  LiveKit, **lecteur simulé de l’API**, arrivée tardive, RTT différent (200 ms
  ajoutés au cinquième client), autoplay bloqué puis activation à la position
  actuelle, pause/play/seek, queue/next/previous, droits, changement de salon,
  correction vérifiée d’un décalage injecté de 3 s, chat/voix simultanés.
- Coupure réseau : reconnexion automatique, salon restauré et activité actuelle
  récupérée ; le stream écran reste reçu après restauration.

Dérive finale mesurée avec le lecteur simulé : de
-0.100 à 12.350 ms, maximum absolu 12.350 ms.
**Cela ne mesure pas le décodage/buffering d’un vrai flux YouTube.**
Sur trois secondes de lecture stabilisée : zéro octet d’événement YouTube
supplémentaire reçu/envoyé par les cinq clients. Sur la séquence de commandes
mesurée : 58272 octets reçus cumulés, 4170 octets émis par les clients,
JSON de contrôle seulement (sans entêtes réseau, authentification, pings ou voix).
Aucun trafic vidéo YouTube routé dans Go/LiveKit.

Données : [youtube-local.json](benchmarks/youtube-local.json),
[screen-local.json](benchmarks/screen-local.json),
[media-local.json](benchmarks/media-local.json).
Capture UI : [youtube-chat-1440.png](screenshots/core/youtube-chat-1440.png).

Le contrôle indépendant `npm run test:youtube-api` utilise le vrai lecteur
IFrame dans Chromium/Linux et le même Referer applicatif que le hook Windows.
L’API se charge (`ready=true`), mais les deux vidéos publiques sondées retournent
l’erreur 150 et restent sans lecture. Donc aucune dérive réelle de décodage
YouTube ni validation Windows physique n’est revendiquée.
Résultat : [youtube-real-api.json](benchmarks/youtube-real-api.json).

## Limitations et livraison

Le lecteur respecte restrictions d’embed, pays, compte, annonces et autoplay.
La V1 vise les vidéos de durée finie ; directs/durées changeantes, annonces et
latences CDN peuvent empêcher une synchronisation fiable. Métadonnées limitées
à l’ID et la durée officielle ; titre et créateur affichés par le player.
Qualité/sous-titres locaux du player ; aucune synchronisation à la frame.
La fenêtre de position/durée acceptée côté contrôle est de 24 heures maximum.

Windows/WebView2 réels : lecture, Referer, buffers et synchro à plusieurs postes
restent à confirmer. Le build MSVC/setup signé est produit par la CI existante,
avec vérification de signature et installation sur un second disque/AppData.
Les nouvelles fonctions YouTube nécessitent le serveur 0.3.0. La migration et
le redémarrage de production requièrent une autorisation distincte ; la version
0.2.2 reste en service pendant la préparation. Aucun nouveau port.

Architecture/configuration/sources : [youtube.md](youtube.md).

## Fichiers modifiés ou ajoutés

- `CLIENT_VERSION`
- `README.md`
- `RELEASE_NOTES.md`
- `SERVER_VERSION`
- `client/package-lock.json`
- `client/package.json`
- `client/src-tauri/Cargo.lock`
- `client/src-tauri/Cargo.toml`
- `client/src-tauri/src/main.rs`
- `client/src-tauri/tauri.conf.json`
- `client/src/Admin.tsx`
- `client/src/App.tsx`
- `client/src/ChatPanel.tsx`
- `client/src/Screens.tsx`
- `client/src/YouTubePanel.tsx`
- `client/src/control.ts`
- `client/src/permissions.ts`
- `client/src/screen.ts`
- `client/src/store.ts`
- `client/src/style.css`
- `client/src/types.ts`
- `client/src/useFullscreen.ts`
- `client/src/version.ts`
- `client/src/youtube-sync.d.mts`
- `client/src/youtube-sync.mjs`
- `client/src/youtube.ts`
- `client/tests/ui.html`
- `client/tests/youtube.test.mjs`
- `docs/benchmarks/media-local.json`
- `docs/benchmarks/screen-local.json`
- `docs/benchmarks/youtube-local.json`
- `docs/benchmarks/youtube-real-api.json`
- `docs/chat-screen.md`
- `docs/phase-youtube-report.md`
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
- `docs/screenshots/core/youtube-chat-1440.png`
- `docs/youtube.md`
- `package.json`
- `scripts/generate-protocol.py`
- `server/internal/config/config.go`
- `server/internal/control/model.go`
- `server/internal/control/server.go`
- `server/internal/control/youtube.go`
- `server/internal/control/youtube_test.go`
- `server/internal/permissions/names_gen.go`
- `server/internal/protocol/version_gen.go`
- `server/internal/store/store_test.go`
- `server/migrations/003_youtube.sql`
- `shared/protocol/v1.schema.json`
- `tools/ui-check/run.mjs`
- `tools/ui-check/youtube.mjs`
- `tools/youtube-check/run.mjs`
