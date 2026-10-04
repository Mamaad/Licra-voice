# Sécurité

Ed25519 authentifie l’identité du client. Il n’authentifie pas le serveur et
ne chiffre pas le WebSocket de contrôle en mode direct-IP HTTP/WS.
Une personne pouvant observer ou modifier le réseau peut voir les pseudos,
bootstrap token au claim, mots de passe de salons et credentials média, ou
usurper un serveur. Les challenges empêchent le replay passif de signatures,
mais ne protègent pas d’un MITM actif relayant une session. Pour des permissions
sensibles et le claim Owner, utiliser TLS sur un réseau non fiable.
Les médias WebRTC sont chiffrés DTLS-SRTP ; ce n’est pas du chiffrement de bout
en bout contre l’opérateur SFU. Aucun mot de passe de compte n’existe.

Les secrets LiveKit restent sur le serveur. JWT participant à 45 secondes,
room fixée après permission, publication microphone seule pour la voix. API Twirp jamais
proxifiée. Le signaling valide session active, salon, droit join et publication.
Le contexte est invalidé avant RemoveParticipant ; les tunnels sont ensuite
fermés des deux côtés et attendus. Sur la version self-hosted de LiveKit, un token ancien n’est pas globalement révoqué comme
sur LiveKit Cloud ; la frontière d’accès repose donc aussi sur le proxy Licra
et le port interne strictement loopback. Ne jamais l’exposer par un autre proxy.

Nonces 32 octets non réutilisables, timeout 10 s ; fingerprints SHA-256 complets.
Limites IP/handshake, max clients, max pending handshakes, 64 KiB par message,
30 requêtes/s par session, hash bcrypt de salon et limite des vérifications
sensibles. BAN par fingerprint préféré ; un nouveau PC peut générer une
nouvelle identité. Les bans IP CIDR, réservés à Owner, sont optionnels et
peuvent affecter plusieurs utilisateurs derrière un NAT.

Bans temporaires évalués à chaque connexion, permanents sans expiry.
DENY prévaut sur tous les ALLOW. Aucun bouton client ne vaut autorisation.
Clés privées DPAPI/backup authentifié ; le serveur ne voit que la clé publique.
Admin token haché en DB, seed de récupération locale 0600, token consommé
atomiquement, supprimé après claim. Le propriétaire Unix dispose de la
réinitialisation volontaire via `admin-token --regenerate`.

Logs JSON sans tokens média ni secrets. Le bootstrap est affiché une seule
fois à l’initialisation ; il reste dans l’historique journald local si journald
conserve cette ligne initiale. L’API client de logs filtre les lignes non JSON
et celles contenant token/secret. Le journal Unix est accessible uniquement
aux utilisateurs autorisés par l’OS. Journald assure rétention/rotation.

L’updater Tauri impose une signature dédiée indépendante de l’identité et
LiveKit. Ne distribuer la clé privée que dans les Secrets CI officiels.
Les futures fonctionnalités de fichiers/Chromium devront ajouter leurs
propres limites et isolation avant d’être annoncées comme disponibles.

## Chat et partage d’écran

Les MP sont accessibles dans l’application aux deux fingerprints de la
conversation, même hors salon vocal. Le serveur stocke leur texte en SQLite :
ils ne sont pas chiffrés de bout en bout. L’opérateur Unix ayant accès à la base
peut les lire. Utiliser TLS pour protéger le contrôle et le texte en transit.

Les messages sont du texte échappé par React. Les liens sont vérifiés côté
client et IPC natif : HTTP/HTTPS uniquement, sans credentials. Aucune iframe,
aucun HTML et aucun Markdown exécutable. L’auteur, le pseudo mémorisé, le salon
et les dates viennent du serveur. Les droits sont vérifiés sur chaque opération
et avant chaque livraison d’événement.

Les tokens écran limitent la room et la source vidéo. Perte de droits, sortie de
salon et déconnexion retirent le participant et invalident son proxy. La room
LiveKit interne doit rester privée. Les quotas de démarrage sont contrôlés
côté serveur ; les dimensions et le nombre de pistes sont contrôlés toutes les
10 secondes, avec 45 secondes de grâce pour une réservation sans piste.
Le bitrate et les FPS sont bornés dans le client officiel ; ce n’est pas un
policier réseau par participant capable de plafonner un client modifié.
