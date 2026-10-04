Licra 0.2.1 — chat persistant et partage d’écran

- Chat par salon : historique SQLite, pagination de 50 messages, messages non lus, indicateur de saisie, réponse, modification et suppression selon permissions.
- MP entre identités Ed25519 du même serveur, y compris hors salon vocal et avec livraison à la prochaine connexion du destinataire. Stockage sur le serveur, sans chiffrement de bout en bout.
- Liens HTTP/HTTPS ouverts dans le navigateur système ; aucun HTML ou JavaScript rendu depuis le chat.
- Partage vidéo d’écran via le sélecteur de la plateforme : plusieurs utilisateurs peuvent partager simultanément. Profils Auto, 1080p, 1440p, Source ; 30/60 FPS demandés, contenu texte/mouvement, focus, plein écran et diagnostics.
- Simulcast, dynacast et réception adaptative LiveKit. H.264 si la plateforme annonce un encodeur économe, sinon VP8 compatible. Source reste compressé.
- Permissions chat/écran atomiques, arrêt par modération, quotas et rétention configurables. Migration SQLite 002 automatique au démarrage du serveur.
- Voix indépendante du partage. Correction d’une course de reconnexion écran lors des changements rapides de permissions et d’un blocage de proxy après coupure réseau. Les retries continuent si l’ancienne session de la même identité attend son expiration.
- Installation Windows et conservation de l’identité/AppData inchangées.

Validation : tests Go avec race detector, persistance après réouverture, vrais échanges WebSocket et LiveKit, deux publishers/deux viewers et un publisher/trois viewers, coupure et reconnexion, permissions, modération, XSS, voix Opus, seuil micro, options audio et affichage de 1000 à 3840 px.

Les captures locales sont synthétiques sous Chromium/Linux : environ 20 FPS observés pour les profils 1080p/1440p, et une source synthétique 96×96. Elles ne prouvent pas 60 FPS ni l’encodage GPU sur un poste Windows physique. Le build Windows est produit par la CI ; le sélecteur moniteur/fenêtre et les GPU physiques restent à confirmer sur vos postes.

Les nouvelles fonctionnalités nécessitent également le serveur 0.2.1. Aucun nouveau port à ouvrir. Configuration et rapport : docs/chat-screen.md et docs/phase-chat-screen-report.md.
