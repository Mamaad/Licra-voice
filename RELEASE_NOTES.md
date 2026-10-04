Licra 0.3.0 — YouTube synchronisé et corrections du partage

- YouTube par salon : lecteur officiel chargé directement depuis chaque client, commandes et file validées serveur, état persistant, arrivée tardive et reconnexion au salon courant.
- Play/pause, seek, précédente/suivante, file bornée et fin décidée par le serveur. Volume et mute YouTube locaux, distincts de la voix.
- Autoplay bloqué : bouton d’activation qui rejoint la position actuelle. Les liens du chat peuvent proposer « Regarder ensemble » sans démarrer automatiquement une vidéo.
- Choix simple entre YouTube et partages d’écran dans le panneau actuel ; le chat et la voix restent accessibles.
- Permissions YouTube atomiques, limites anti-spam et migration SQLite 003. Les vidéos en lecture reprennent en pause après redémarrage serveur.
- Plein écran : le bouton permet aussi de revenir en mode normal, y compris pour un lecteur apparu après le montage du panneau.
- Partage d’écran : budgets vidéo doublés et plafond serveur par défaut de 16 Mbit/s. Adaptation réseau et plafond administrateur conservés.

Le bandeau de capture « tauri.localhost » reste géré par WebView2, qui n’expose pas de réglage stable pour le masquer dans la stack actuelle.

Validation : tests Go avec race detector, cinq clients de contrôle avec latence différente, lecteur simulé de l’API YouTube, autoplay bloqué, queue, dérive, permissions, voix/chat simultanés, reconnexion et toutes les régressions existantes. Le vrai lecteur officiel se charge dans le diagnostic Linux, mais les vidéos sondées renvoient une restriction d’intégration (150) : synchronisation réelle, annonces et buffers/CDN restent à vérifier sur Windows. Les directs et les vidéos à durée changeante ne sont pas une cible fiable de cette V1.

YouTube nécessite aussi le serveur 0.3.0. Aucun nouveau port, aucune vidéo YouTube ne passe par le serveur Licra. Identités et AppData conservés.
