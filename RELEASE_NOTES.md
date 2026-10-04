Licra 0.1.1 — correctifs audio et mises à jour

- Périphériques audio listés sans demander l’accès à une caméra, avec actualisation lors des branchements.
- Capture micro partagée : activation vocale, jauge et indicateur de parole suivent la même source.
- Jauge micro en temps réel, seuil réglable en dB et repère visuel dans les paramètres.
- Changements du seuil sans redémarrage du micro ; indicateur de parole conservé après modification des options.
- Accès microphone accordé à l’interface locale Licra via Tauri, en respectant les restrictions Windows.
- Refus d’accès au microphone et permissions serveur distingués ; erreurs serveur contextualisées.
- Réclamation Owner dans une section repliée des paramètres, masquée après consommation du bootstrap.
- Bouton « Mettre à jour » visible, état « à jour », téléchargement signé, installation et relance.
- Scripts start.sh et stop.sh pour les services systemd utilisateur.

Les microphones physiques Windows et la mise à jour interactive depuis 0.1.0 doivent encore être confirmés sur vos postes.
