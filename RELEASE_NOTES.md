Licra 0.3.2 — fenêtres d’activités redimensionnables

- Les panneaux YouTube et partage d’écran se redimensionnent en largeur et en hauteur avec la poignée native de la fenêtre. Leur taille reste bornée à l’application, à sa barre supérieure et à sa barre de contrôle inférieure.
- Le contenu continue de défiler dans le panneau quand sa taille diminue. Le lecteur YouTube conserve sa taille minimale de lecture.
- Licra ne télécharge ni n’enregistre les fichiers des vidéos YouTube sur son serveur. Chaque client lit directement la vidéo depuis YouTube. La base de données garde uniquement l’état de l’activité, l’identifiant vidéo, la position et les identifiants des vidéos de la file/historique. Changer de vidéo remplace cet état et le lecteur côté client ; aucun fichier vidéo serveur n’existe à supprimer.
- Le serveur 0.3.0 reste compatible ; aucun redémarrage ni nouveau port n’est nécessaire. Voix, partage écran, chat, identité et AppData conservés.
