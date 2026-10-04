# YouTube synchronisé — Licra 0.3.0

## Architecture et réseau

Le lecteur officiel YouTube IFrame Player API charge directement YouTube depuis
chaque client. Le serveur Go transporte uniquement l’état et les commandes sur
le WebSocket authentifié existant : aucun téléchargement, proxy, retransmission
LiveKit, transcodage, scraper ou clé YouTube Data API. La voix et les partages
LiveKit existants sont conservés.

Une activité par salon rejoint : ID vidéo, état `STOPPED/PLAYING/PAUSED`, position
et timestamp de référence serveur en millisecondes, auteur initial, dernier
contrôleur/pseudo, date, révision, durée, file et historique des vingt dernières
vidéos. Migration `003_youtube.sql` : `youtube_activities(channel_id,payload)`
avec suppression en cascade lorsqu’un salon est supprimé.

La position courante est calculée depuis la référence, sans incrément permanent
ni diffusion périodique. Après réception de la durée par un client autorisé,
une seule échéance de fin est programmée pour cette révision. Play, pause, seek,
file, stop et changement de vidéo remplacent cette échéance. Le serveur choisit
la suivante ; des notifications de fin concurrentes ne peuvent pas avancer deux
fois la file. La durée reste une indication fournie par le lecteur d’un client
autorisé à changer la vidéo ou son auteur encore autorisé à démarrer, pas une métadonnée vérifiée par une API serveur.

À l’arrêt normal, les vidéos en lecture sont persistées en pause à leur position
canonique. Après un crash, reprise en pause à la dernière référence persistée,
sans compter la durée de panne. Queue et historique restent conservés.

## Permissions et commandes

Permissions : `youtube.view`, `youtube.start`, `youtube.control`, `youtube.seek`,
`youtube.change_video`, `youtube.stop`, `youtube.queue_manage`.
Le rôle Guest peut voir ; Member, Moderator, Administrator et Owner disposent
par défaut des commandes. Les règles existantes sont conservées, DENY prioritaire.
Seek exige `control` et `seek` ; reprendre une activité arrêtée exige aussi `start`.
Toutes les actions sont limitées au salon réellement rejoint et validées serveur.

Commandes : `YOUTUBE_GET`, `YOUTUBE_START`, `YOUTUBE_PLAY`, `YOUTUBE_PAUSE`,
`YOUTUBE_SEEK`, `YOUTUBE_STOP`, `YOUTUBE_NEXT`, `YOUTUBE_PREVIOUS`,
`YOUTUBE_DURATION`, `YOUTUBE_ENDED`, `YOUTUBE_QUEUE_ADD`, `YOUTUBE_QUEUE_REMOVE`,
`YOUTUBE_QUEUE_MOVE`, `YOUTUBE_QUEUE_CLEAR`.
Événement : `YOUTUBE_STATE`, avec activité, salon et heure serveur.
Snapshot : `youtube`, `youtube_activity`, `server_time`. PONG : `server_time`.
Compatibilité additive du protocole v1, capacité `youtube_sync`.

Chaque mutation contient la dernière révision connue. Un état périmé reçoit
l’état courant et `STALE_ACTIVITY`, sans écraser une commande concurrente.
Les événements anciens sont ignorés côté client.

## Horloge et correction de dérive

PING/PONG réutilisés. L’envoi et la réception utilisent
`performance.timeOrigin + performance.now()` ; le décalage estimé vaut
`server_time - (t_send + t_receive)/2`. Le meilleur RTT parmi huit échantillons
récents de deux minutes limite le biais de files d’attente. L’horloge Date locale
n’est pas utilisée comme autorité. Une asymétrie réseau peut encore biaiser
l’estimation ; les diagnostics exposent offset, RTT et dérive.

La position du lecteur est observée localement chaque seconde. Une dérive
supérieure à 1,25 s provoque un seek occasionnel, avec huit secondes entre
corrections périodiques. Une commande serveur peut corriger immédiatement ;
en pause, seuil de 250 ms. Aucun ajustement de playback rate : l’API ne garantit
pas 0,95x/1,05x. Le client conserve le débit normal. La timeline envoie un seul
seek au relâchement de la souris ou d’une touche, sans événement par pixel.

## Join, reconnexion, autoplay et interface

L’activité du salon est reconstruite depuis le snapshot ou `YOUTUBE_GET`.
Après coupure involontaire, le client redemande le salon précédemment rejoint
avec le mot de passe conservé uniquement en mémoire, puis reçoit l’état courant.
Une déconnexion explicite efface ce choix. Lors d’un changement de salon,
le lecteur précédent est détruit ; pas de vidéo d’un autre salon en arrière-plan.

Le navigateur peut bloquer la lecture. Le bouton « Cliquez pour démarrer la
lecture synchronisée » appelle le lecteur depuis le geste de l’utilisateur
et utilise la position canonique actuelle. Aucun flag de contournement autoplay
n’est ajouté à l’application. Volume et mute YouTube restent locaux, persistés
avec les réglages ; ils n’affectent ni la pause partagée ni le volume vocal.

Le panneau central réutilise les styles existants et propose YouTube ou partages
d’écran comme activité principale. Le chat reste présent. Un lien YouTube dans
un message de salon reste du texte : l’action « Regarder ensemble » exige un
clic explicite et les droits nécessaires. Les MP ne lancent pas d’activité.

IDs de onze caractères strictement validés et hôtes officiels : youtube.com,
www/m/music.youtube.com, youtu.be, formats watch/shorts/embed/live. Le serveur
n’effectue aucune requête vers ces URLs ; seul l’ID est utilisé pour le lecteur.
Aucune URL arbitraire dans une iframe. CSP limitée aux scripts YouTube/ytimg et
aux iframes youtube.com. Sur Windows, le Referer du document d’embed identifie
Licra par `https://org.licra.voice`, comme demandé pour les apps WebView par Google.
Les restrictions de vidéos, géographiques, de compte et d’intégration sont respectées.

Métadonnées : ID et durée accessible via `getDuration`. Titre/miniature/créateur
restent affichés par le lecteur officiel ; aucune API supplémentaire ni scraping.
Qualité et sous-titres restent locaux dans ce lecteur.

## Configuration

```toml
[youtube]
enabled = true
max_queue = 100
commands_per_minute = 120
changes_per_minute = 10
```

Les requêtes YouTube sont aussi plafonnées à 240/minute par fingerprint.
Limites vérifiées à l’entrée, file bornée, historique limité à vingt éléments.
Aucune nouvelle ouverture de port. Les anciennes configurations reçoivent ces
valeurs par défaut ; un plafond écran explicite est conservé.

## Plein écran, débit écran et indicateur WebView2

Le bouton partagé entre écran et YouTube bascule réellement entre entrée/sortie,
avec remise de la fenêtre Tauri en mode normal après sortie DOM. Les lecteurs
montés après le panneau et l’arrêt d’un lecteur en plein écran sont pris en compte.

Les budgets vidéo écran et caps des couches simulcast sont doublés : cible
1080p30 de 8 Mbit/s au total, plafond serveur par défaut de 16 Mbit/s,
couche principale à 70 %, moyenne 25 %, basse 5 %. Le débit réel reste adaptatif
et un plafond défini explicitement par l’administrateur est respecté.

Le bandeau « tauri.localhost partage une fenêtre » appartient à WebView2.
L’API stable examinée permet d’autoriser/bloquer la capture, pas de personnaliser
ou masquer l’indicateur en cours. La demande Microsoft de remplacement de cet
indicateur est toujours ouverte. Ce bandeau n’est donc pas supprimé par cette
version ; aucun flag Chromium non documenté n’est utilisé.

Sources officielles : [IFrame API](https://developers.google.com/youtube/iframe_api_reference),
[identification WebView](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity),
[ScreenCaptureStarting](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2screencapturestartingeventargs),
[demande d’indicateur personnalisable](https://github.com/MicrosoftEdge/WebView2Feedback/issues/2442).

## Limites YouTube

Les annonces, les directs et les durées changeantes peuvent rendre la
synchronisation moins fiable. La V1 vise les vidéos à durée finie ; une échéance
calculée depuis une durée fournie par le lecteur n’est pas adaptée à un direct.
La position canonique ne réserve pas de frame ni de buffer identiques entre
les clients. Une vidéo interdite à l’intégration affiche l’erreur et doit être
remplacée par un contrôleur. Aucune restriction YouTube n’est contournée.

Le diagnostic `npm run test:youtube-api` charge le vrai lecteur et écrit
`docs/benchmarks/youtube-real-api.json`. Il distingue disponibilité de l’API et
lecture réelle. L’environnement Linux d’essai a reçu l’erreur 150 pour les vidéos
sondées : la lecture réelle simultanée et les buffers/CDN sur Windows restent
à confirmer. Les tests déterministes de synchronisation utilisent un lecteur
simulé de l’API officielle ; leurs chiffres de dérive ne mesurent pas un décodage
YouTube réel. Voir le rapport de phase pour les résultats et les builds.
