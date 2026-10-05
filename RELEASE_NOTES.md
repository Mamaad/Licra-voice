Licra 0.3.1 — Chat principal, activités séparées et pause YouTube

- Le chat du salon occupe la zone centrale, avec les messages et la saisie visibles sans parcourir les panneaux média.
- Le menu « Activités » ouvre YouTube ou les partages dans une fenêtre dédiée. Réduire cette fenêtre ferme le lecteur local ; la réouverture rejoint la position actuelle du salon. Le chat reste accessible.
- Pause et lecture depuis les boutons du lecteur YouTube transmettent maintenant une commande autorisée au serveur. La synchronisation périodique ne relance plus une pause volontaire autorisée.
- Plein écran vidéo : aucun cadre ni bandeau de l’application ne réserve de place. L’image remplit l’écran par défaut ; « Tout afficher » conserve l’image entière si les formats diffèrent, et « Remplir l’écran » revient au mode sans bandes. Le remplissage peut rogner les bords d’une source de format différent, sans déformation.
- Voix, chat, MP, identité, permissions, bitrate et AppData conservés. Compatible avec le serveur 0.3.0 déjà installé ; aucun redémarrage serveur requis pour ces corrections client.

Les bandes présentes dans la source capturée elle-même ne peuvent pas être supprimées sans recadrer cette source. L’indicateur de capture WebView2 reste géré par Windows. La lecture et la synchronisation d’un vrai flux YouTube sur des postes Windows restent à confirmer ; les vérifications automatisées de commandes utilisent le lecteur simulé de l’API officielle.
