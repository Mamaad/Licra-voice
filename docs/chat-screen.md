# Chat et partage d’écran — 0.2.2

## Stockage et migration

`server/migrations/002_chat.sql` ajoute `chat_peers`, `chat_threads`,
`chat_messages` et `chat_reads`, avec index `(thread_id,id)` et `created_at`.
Les migrations sont embarquées et appliquées transactionnellement au démarrage.
La migration 001, les identités, salons, bans et rôles existants sont conservés.
Les nouvelles règles par défaut sont ajoutées uniquement si elles n’existent
pas. Sauvegarder la base avant mise à jour ; restaurer cette sauvegarde pour
un retour complet à la version précédente.

Les messages ont un ID SQLite monotone, un auteur Ed25519 vérifié, un pseudo
mémorisé et des dates UTC serveur. Pagination par ID, 50 messages par page,
lecture de 51 lignes pour déterminer la présence d’une page précédente.
La citation conserve seulement l’ID du message, avec une jointure pour l’aperçu.
Suppression logique : texte masqué pour les lecteurs ordinaires ; un modérateur
avec `chat.moderation.view_deleted` peut voir les messages de salon supprimés.
Ce droit n’ouvre jamais les MP d’autrui. La rétention supprime physiquement les
anciens messages, y compris ceux supprimés logiquement.

Les conversations privées ont un identifiant SHA-256 de
`server_id + "\n" + min(fingerprintA,B) + "\n" + max(fingerprintA,B)`.
Elles sont accessibles seulement à ces deux identités. Le destinataire doit
avoir déjà rejoint ce serveur ; s’il est hors ligne, le message est enregistré
et devient visible à sa reconnexion avec la même identité. Aucun transfert
entre serveurs et aucun compte central. Le retrait du droit d’envoi conserve
la lecture d’une conversation existante. Le serveur stocke le texte : pas d’E2EE.

Les événements de saisie restent en mémoire et expirent après six secondes côté
client. Les compteurs non lus viennent d’un curseur de lecture par identité et
conversation ; pas d’écriture à chaque frappe ou déplacement de souris.
Le cache client garde au plus dix conversations et mille messages par
conversation. L’historique complet se consulte par pages successives.

## Permissions

| Permission | Droit |
|---|---|
| `chat.channel.view` | Lire le chat du salon et recevoir ses événements |
| `chat.channel.send` | Envoyer au salon |
| `chat.channel.history` | Lire les pages persistées |
| `chat.channel.edit_own` | Modifier ses messages |
| `chat.channel.delete_own` | Supprimer ses messages |
| `chat.channel.delete_others` | Modérer les messages du salon |
| `chat.private.send` | Créer une conversation et envoyer des MP |
| `chat.moderation.view_deleted` | Lire les contenus supprimés du salon |
| `screen.share` | Publier son écran dans son salon vocal |
| `screen.watch` | Recevoir les écrans de son salon vocal |
| `screen.stop_others` | Arrêter le partage d’un autre participant |

Le refus `DENY` prime sur tous les droits accordés, y compris lorsqu’un
utilisateur cumule plusieurs rôles. Guest/Member peuvent chatter et partager
par défaut ; Moderator dispose en plus des droits de modération. Les paramètres
serveur peuvent désactiver entièrement chaque fonctionnalité.

## Protocole v1 compatible

Enveloppes de contrôle et authentification Ed25519 existantes conservées.
`SERVER_HELLO.features` annonce `chat` et `screen_share` ; `SNAPSHOT` fournit
les limites `chat` et `screen`. Chaque opération répond avec `ACK` ou `ERROR`.

| Requête | Payload / réponse |
|---|---|
| `CHAT_OPEN` | `channel_id` ou `peer_fingerprint` → thread et page récente |
| `CHAT_HISTORY` | `thread_id`, `before` facultatif → page de 50 |
| `CHAT_SEND` | `thread_id`, `content`, `reply_to_message_id` nullable |
| `CHAT_EDIT` | `thread_id`, `message_id`, `content` |
| `CHAT_DELETE` | `thread_id`, `message_id` |
| `CHAT_READ` | `thread_id`, `message_id` → curseur monotone |
| `CHAT_LIST` | Conversations accessibles et non lus |
| `CHAT_TYPING` | `thread_id`, `active` |
| `SCREEN_START` | `quality`, `fps`, `content` → JWT et chemin signaling |
| `SCREEN_JOIN` | `{}` → JWT spectateur du salon courant |
| `SCREEN_STOP` | `user_id` facultatif, sinon soi-même |

Événements : `CHAT_MESSAGE_CREATED/EDITED/DELETED`,
`PRIVATE_MESSAGE_CREATED/EDITED/DELETED`, `TYPING_STARTED/STOPPED`,
`CHAT_UNREAD` (complet ou `partial:true`), `SCREEN_STATE` (partages autorisés),
`SCREEN_REVOKED` (`publishing_only:true` peut conserver la réception).
`SCREEN_STATE` est renvoyé après le snapshot : les arrivants reconstruisent
la liste puis s’abonnent aux publications LiveKit actuelles.

Erreurs supplémentaires : `CHAT_DISABLED`, `CHAT_STORAGE_LIMIT`,
`SCREEN_DISABLED`, `SCREEN_LIMIT`, `SCREEN_ALREADY_ACTIVE` ; erreurs communes
`PERMISSION_DENIED`, `RATE_LIMITED`, `INVALID_INPUT`, `DATABASE_ERROR` et
`MEDIA_UNAVAILABLE`. Les ID de messages sont des chaînes décimales sur le fil.

## Configuration TOML

Les anciennes configurations reçoivent ces valeurs par défaut. Ajouter les
sections pour les modifier, puis redémarrer le serveur applicatif.

```toml
[chat]
enabled = true
history_enabled = true
max_message_length = 4000
messages_per_second = 3
messages_per_minute = 60
edits_per_minute = 30
typing_per_second = 2
channel_history_limit = 10000
private_history_limit = 5000
retention_days = 90
max_stored_messages = 100000
max_threads = 10000

[screen_share]
enabled = true
max_shares_per_channel = 4
max_bitrate = 16000000
max_height = 2160
max_fps = 60
```

Longueur en points de code Unicode ; limites de requêtes par fingerprint,
y compris après reconnexion. Limites globales de conversations et messages,
plus plafonds par conversation. Purge au démarrage et périodiquement lors de
l’activité chat. `history_enabled=false` masque les pages persistées et garde
au plus le dernier message par conversation pour les événements/curseurs ;
ce réglage ne signifie pas zéro stockage et ne supprime pas instantanément
l’historique déjà présent. La base SQLite peut conserver l’espace disque alloué
après une purge ; les limites portent sur les lignes retenues.

`max_fps` doit être compris entre 30 et 60. Le profil 60 FPS est proposé si le
plafond l’autorise. Les profils dépassant `max_height` sont indisponibles.
Les changements de configuration passent par le fichier du serveur.

## Média écran

Capture par `getDisplayMedia`, appelée depuis le clic utilisateur avant toute
attente réseau : sélecteur de source fourni par la plateforme WebView2/Windows.
Pas de capture desktop maison ; disponibilité contrôlée avant usage.
Une source vidéo par utilisateur, plusieurs publications par salon. Pas d’audio
système dans cette phase. La voix reste dans `channel_<UUID>` et le partage
dans `screen_<UUID>`, avec grants distincts. Le serveur Go contrôle les accès,
LiveKit 1.13.7 relaie les paquets ; aucun décodage, composition ou transcodage.
SDK client existant : LiveKit JS 2.22.3, APIs publiques.

Auto/1080p/1440p/Source, 30/60 FPS, contenu Auto/Texte/Mouvement. Source demande
la résolution native dans le plafond administrateur : vidéo compressée,
jamais lossless. Auto plafonne initialement à 1080p puis laisse WebRTC adapter.
Budget vidéo : environ 4 Mbit/s en 1080p30, augmenté selon résolution et FPS,
plafonné à 8 Mbit/s par défaut, réparti entre les couches. Priorité vidéo basse,
voix indépendante. Cette priorité est une indication WebRTC ; deux connexions
ne garantissent pas une réservation de bande passante commune pour la voix.

H.264 est préféré si `MediaCapabilities.encodingInfo` annonce un encodeur
supporté et économe pour la résolution/FPS demandés. Sinon VP8 compatible ;
H.264 reste le secours si VP8 est absent. Aucun AV1/VP9 forcé et aucune promesse
d’accélération matérielle sans constat de la plateforme.

Simulcast jusqu’à trois couches (640, 1280 et largeur source), dynacast activé,
adaptive stream activé. Les éléments vidéo attachés au SDK déterminent la couche
nécessaire selon visibilité/taille. Focus et plein écran demandent une couche
plus haute ; les couches inutilisées peuvent être suspendues. Les diagnostics
exposent codec, dimensions/FPS réels, compteurs d’octets/paquets, pertes, RTT,
raison de limitation, couches et état actif des encodages.

## Limites de cette livraison

Pas de recherche, Markdown, pièces jointes, webcam, audio système, navigateur
collaboratif, YouTube ni tableau blanc. Les liens HTTP/HTTPS s’ouvrent dans le
navigateur système, après double vérification du schéma côté React et IPC.

La validation locale emploie une capture synthétique Chromium/Linux et un vrai
SFU : elle ne remplace pas un essai sur un écran/GPU Windows physique, ni un
test Internet saturé. La consommation GPU n’est pas observable localement.
Les plafonds bitrate/FPS sont appliqués par le client officiel ; les dimensions,
source et nombre de pistes sont surveillés serveur, sans policier réseau dédié.
Le contrôle sérialise les mutations et les appels média : à grande échelle,
mesurer sa latence avant de déplacer ces appels hors du verrou existant.

Depuis 0.3.0, les budgets du client et le plafond écran par défaut sont doublés (16 Mbit/s). Un plafond explicitement configuré par un administrateur reste respecté.
