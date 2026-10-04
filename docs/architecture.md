# Architecture

```text
Windows : Tauri/WebView2 → contrôle WebSocket → serveur Go → SQLite WAL
Windows : Opus/WebRTC → LiveKit SFU → destinataires du même salon
Windows : signaling → BASE_PORT /livekit/rtc → LiveKit HTTP loopback
```

Le serveur Go authentifie les identités, contrôle les salons et les rôles,
génère des JWT HS256 à 45 secondes et utilise l’API Twirp locale de LiveKit.
Il ne transporte pas les paquets audio, ne décode pas Opus et ne mixe rien.
LiveKit fonctionne dans un service distinct, mono-node sans Redis.
Les ports RTC UDP/TCP sont publics ; le port HTTP interne est sur loopback.

Une room est nommée `channel_<UUID>` : renommer un salon ne la change pas.
Une session LiveKit est identifiée par l’UUID de la connexion de contrôle,
qui est lié à un fingerprint complet SHA-256 de la clé publique Ed25519.
Le contrôle reste connecté pendant les changements de rooms.
Lors d’un déplacement, le serveur annule les anciens tunnels de signaling,
attend leur fermeture et retire le participant avant de délivrer le nouveau
salon. Le proxy rejette ensuite les credentials de l’ancien salon.
Les tokens permettent uniquement la publication microphone ; publication
vidéo et data sont interdites en V1.

Les présences et limites de requêtes sont en mémoire. SQLite contient les
identités publiques connues, salons, attributions, bans et configuration.
Résolution RBAC en mémoire, rechargée après mutation, sans requête SQL pour
chaque événement audio. Une seule connexion SQL assure les PRAGMA et
transactions. Migrations SQL embarquées, ordonnées, versionnées et atomiques.

Le control plane sérialise ses mutations pour garantir les invariants.
Les appels LiveKit ont un timeout de 3 secondes. Les gros changements de
permissions impliquant beaucoup de participants peuvent retarder le contrôle ;
le média SFU reste indépendant. Mesurer avant de déplacer ces I/O hors verrou.
Le stockage SQL utilise `database/sql` et un package `store` : un autre pilote
et des migrations adaptées peuvent être ajoutés sans introduire aujourd’hui
un second backend ou une interface factice.

Les indicateurs de parole utilisent WebAudio dans le client. Aucun niveau
n’est envoyé par le client sur le WebSocket de contrôle. Le SDK LiveKit peut
continuer à produire ses propres notifications de speakers ; l’interface
calcule ses indicateurs à partir des pistes audio reçues localement.

`FeatureCapability` prévoit `voice`, `screen_share`, `youtube_sync`,
`server_files`, `remote_browser`. Seule `voice` est annoncée. Les futures
sources écran passeront par le même SFU après évolution des grants.
Le futur Chromium devra s’exécuter dans un service `browser-worker` isolé,
jamais dans le serveur Go principal. Les ACL futures sont déjà présentes ;
leur présence ne constitue pas une implémentation de ces fonctionnalités.
