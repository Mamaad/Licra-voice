Licra 0.1.3 — déplacements et statistiques vocales

- Glisser-déposer des utilisateurs depuis l’arbre ou la liste des membres pour changer de salon, selon leurs permissions.
- Glisser-déposer des salons : avant/après pour leur ordre, au centre pour les imbriquer, ou vers la zone racine. Les cycles sont refusés.
- Statistiques vocales accessibles en cliquant sur « Connecté » : RTT contrôle et média, jitter, pertes de paquets, débits, codec et transport. Actualisation chaque seconde.
- Marque Licra ; suppression du libellé « voix sans compte » dans la barre latérale et de la recherche de membre en haut.
- Un changement d’ordre ou de description ne force plus une reconnexion vocale avec le serveur 0.1.3.
- Conservation de l’identité, des paramètres et du cache dans AppData du profil Windows, comme demandé. Vérification de l’installation et de la mise à jour sur un second disque, avec un chemin contenant des espaces.

Vérifications : compilation TypeScript et Windows, interactions sur serveur isolé, permissions, absence de reconnexion lors du réordonnancement, affichage 1000/1100/1440/1920/3840 px, échanges Opus et régressions audio.
Les périphériques physiques et le glisser-déposer dans WebView2 restent à confirmer sur vos postes Windows.
