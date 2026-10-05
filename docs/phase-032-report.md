# Licra 0.3.2 — panneau d’activité redimensionnable et médias YouTube

## Fenêtre d’activité

Le même panneau utilisé pour YouTube et les partages a maintenant une taille
initiale adaptée au bureau et une poignée native CSS `resize: both`. Largeur
et hauteur minimale/préférée/maximale sont bornées au viewport et placées sous
la barre supérieure et au-dessus de la barre audio. L’adaptation mobile garde
un panneau étroit adapté à la largeur disponible. Le panneau interne défile
quand son contenu ne tient plus ; les commandes restent utilisables.

## Fichiers YouTube

Aucun fichier vidéo n’est reçu, créé, transféré ou conservé par Licra. Les
clients utilisent le lecteur IFrame officiel directement depuis YouTube/CDN.
Le serveur contrôle ne voit et ne relaie que des événements et métadonnées de
synchronisation. SQLite stocke une ligne par salon avec un document d’état :
ID de la vidéo courante, lecture/pause, position/horodatage, rôles/auteur,
durée fournie par le lecteur, révision, queue d’IDs et vingt précédents IDs.
Aucun champ ne porte de données vidéo, URL de flux, miniature téléchargée ou
chemin temporaire.

Changer de vidéo met à jour l’ID, l’état et la durée dans l’activité SQLite
existante ; le lecteur client charge l’ID courant avec l’API officielle. Les
anciens médias ne sont jamais copiés sur le serveur. Les IDs restent dans le
petit historique `previous` pour la commande Précédente ; aucune opération de
suppression de fichier n’est nécessaire.

## Vérification et livraison

La compilation TypeScript/Vite passe. `check-versions.py`, la vérification des
types de protocole générés et `git diff --check` passent également. L’inspection
du code SQLite, des événements WebSocket et du chargement client confirme le
flux direct YouTube et le stockage exclusif de l’état ci-dessus. Les suites de
tests ne sont pas relancées localement pendant cette phase ; la CI de publication
reste le contrôle complet avant la release.

Correction limitée au client/CSS et au versionnement commun, sans changement
de protocole ni migration. Serveur de production 0.3.0 compatible ; pas de
redémarrage de contrôle/LiveKit et pas de nouveau port.
