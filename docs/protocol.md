# Protocole v1

Source canonique : `shared/protocol/v1.schema.json`.
`python3 scripts/generate-protocol.py` génère les types TypeScript, constantes
et permissions. `--check` détecte un fichier généré obsolète en CI.
Les structures Go des modèles et enveloppes correspondent à ce contrat.

Chaque enveloppe contient `type`, `timestamp` RFC3339 et `payload`, avec
`request_id` pour une requête/réponse ou `event_id` pour un événement.
Le serveur répond `ACK` après une mutation. `ERROR.payload.code` est stable.

1. `CLIENT_HELLO`: `protocol_version`, `client_version`, `nickname`,
   `device_public_key` (32 octets, base64 standard), `platform`, `capabilities`.
2. `SERVER_HELLO`: version protocole/serveur, nom/id, nonce, contexte signé,
   `media_configuration`, `minimum_client_version`, `features`.
3. `AUTHENTICATE`: signature Ed25519 base64 du contexte UTF-8 exact :
   `licra:v1\n<server_id>\n<nonce>\n<client_version>\n<nickname>\n<public_key>`.
4. `SNAPSHOT`: serveur, `self_id`, salons, utilisateurs, rôles visibles,
   `permissions` globales et `channel_permissions` par UUID.
5. Événements différentiels `USER_*`, `CHANNEL_*`, `ROLE_UPDATED`,
   `PERMISSIONS_UPDATED`, `VOICE_STATE_UPDATED`, `SERVER_INFO_UPDATED`.

Nonce aléatoire 32 octets, consommé même en cas de signature incorrecte,
valide 10 secondes, lié à la session et au serveur. Une identité ne peut avoir
qu’une connexion simultanée. Une autre connexion avec la même identité
reçoit `IDENTITY_CONNECTED`.

Commandes :

| Commande | Payload |
|---|---|
| CLAIM_OWNER | token |
| SET_NICKNAME | nickname |
| JOIN_CHANNEL | channel_id, password facultatif |
| LEAVE_CHANNEL / REFRESH_VOICE | {} |
| VOICE_STATE | muted, deafened |
| MOVE_USER | user_id, channel_id |
| CREATE_CHANNEL / UPDATE_CHANNEL | champs Channel, password facultatif |
| DELETE_CHANNEL | id |
| UPSERT_ROLE | id vide pour création, name, permissions |
| DELETE_ROLE | id |
| ASSIGN_ROLE | fingerprint, role_id, channel_id vide = SERVER, remove |
| SET_OVERRIDE | channel_id, role_id, permission, effect |
| LIST_DEVICE_ROLES / LIST_OVERRIDES / LIST_BANS | {} |
| KICK_USER / BAN_USER | user_id ou fingerprint pour ban, reason, expires_at nullable, ip_cidr facultatif |
| DELETE_BAN | id |
| MUTE_USER | user_id, muted |
| CHANGE_NICKNAME | user_id, nickname |
| EDIT_SERVER | name |
| GET_SERVER_LOGS / GET_SERVER_DIAGNOSTICS / SHUTDOWN_SERVER | {} |

`VOICE_JOIN` contient un token de 45 secondes, le chemin du signaling,
le salon, profil audio et `can_speak`. Le client quitte la précédente room et
rejoint la nouvelle. Un changement de profil demande une reconnexion média.
`VOICE_LEFT` signifie retrait de l’accès au salon.

Erreurs : `INVALID_INPUT`, `INCOMPATIBLE_VERSION`, `AUTH_FAILED`,
`BANNED`, `RATE_LIMITED`, `SERVER_FULL`, `IDENTITY_CONNECTED`,
`PERMISSION_DENIED`, `INVALID_ADMIN_TOKEN`, `CHANNEL_NOT_FOUND`,
`USER_NOT_FOUND`, `CHANNEL_FULL`, `CHANNEL_PASSWORD`, `CHANNEL_LIMIT`,
`CHANNEL_HAS_CHILDREN`, `CHANNEL_OCCUPIED`, `PROTECTED_ROLE`, `LAST_OWNER`,
`MEDIA_UNAVAILABLE`, `DATABASE_ERROR`, `LOGS_UNAVAILABLE`, `UNKNOWN_OPERATION`.
Handshake saturé : HTTP 503 ; rate limit par IP : HTTP 429.

Le serveur envoie `PING` toutes les 15 secondes ; le client répond `PONG`.
Sans message depuis 45 secondes, la connexion est retirée. Message entrant
limité à 64 KiB ; queue par session à 128 événements, clients lents fermés.
Les messages audio ne transitent pas par ce protocole.
Compatibilité : version de protocole identique et SemVer client supérieure
ou égale au minimum annoncé, sans égalité obligatoire avec le serveur.
Les prereleases nécessiteront une extension de cette compatibilité.
