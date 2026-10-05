# Licra 0.3.1 — corrections du lecteur et disposition du salon

## Corrections

La synchronisation YouTube réappliquait l’état PLAYING du serveur après une
pause effectuée dans le lecteur IFrame. Les transitions natives play/pause
inattendues déclenchent maintenant une commande validée par le serveur si
l’utilisateur possède `youtube.control`. Les événements provoqués par les
commandes du programme sont ignorés afin d’éviter les boucles de broadcast.
Pendant une commande en vol, la correction périodique attend son résultat.
Les utilisateurs sans permission ne peuvent pas modifier la lecture du salon.

Le chat devient la surface principale : bannière compacte, informations du
salon repliées, historique extensible et saisie toujours présente. Le menu
« Activités » remplace les boutons et panneaux empilés. La fenêtre média est
séparée et réductible ; réduire ferme le lecteur local sans arrêter l’activité partagée. Réouvrir
reconstruit le lecteur à la position actuelle du salon, sans lecture cachée.
Le choix d’un autre salon détruit son lecteur précédent ; les droits restent
vérifiés côté serveur. Sur les petites fenêtres, réduire l’activité redonne
la place au chat. Les membres restent accessibles dans l’arborescence.

Le partage plein écran occupe exactement le viewport sans bordure ni en-tête
réservé. Les contrôles sont superposés et apparaissent au survol/focus clavier.
`object-fit: cover` remplit sans déformer ; les formats différents rognent les
bords. « Tout afficher » passe en `contain` et conserve toute l’image avec
les bandes nécessaires ; « Remplir l’écran » restaure le remplissage.
Les bandes déjà capturées dans la source restent des pixels de cette source.

## Vérifications et livraison

Contrôle local réussi : TypeScript/Vite, versions et protocole ; suite UI
existante complète avec les nouveaux scénarios, benchmark vidéo Source ciblé.
Les profils vidéo 1080p30/60, 1440p30/60 et Source30 ont aussi été exécutés
lors du passage complet précédent. Leur JSON est conservé séparément du
passage ciblé. La CI officielle a réexécuté les suites complètes sur le code
final et compilé l’installateur MSVC signé. La suite existante contient des
vérifications de pause native durable au-delà de deux ticks, de lecture native,
de propagation aux cinq clients, de réduction et reconstruction du player à la position actuelle,
de chat pendant activité réduite et de dimensions plein écran égales au viewport.
Les tests utilisent l’API IFrame simulée pour ces transitions, pas un vrai
flux YouTube. Aucune mesure de buffering/décodage Windows n’est revendiquée.

Corrections exclusivement client : le serveur 0.3.0 actuel est compatible,
sans migration ou redémarrage. La version serveur du bundle est 0.3.1 pour
respecter le versionnement commun ; son comportement n’a pas changé.

Sur la capture utilisateur, « LiveKit indisponible » est visible. Les services
contrôle/LiveKit actuels sont actifs et le contrôle média répond normalement.
Aucune cause permanente n’est reproduite ; aucun service n’a été redémarré.

Lecture visible : [exigences du lecteur officiel](https://developers.google.com/youtube/terms/required-minimum-functionality#autoplay-and-scripted-playbacks).

## Validation officielle

Code : `3527b380b2dc141c7ef8f844783b078af86075a3`.
[Validate 37301819002](https://github.com/Mamaad/Licra-voice/actions/runs/37301819002) :
job Linux réussi sur le code final, avec Go race/vet/build et les suites média
et UI complètes, y compris largeur du chat à côté du média, pause native,
réouverture synchronisée et dimensions plein écran. Résultat indépendant de
la vérification locale ciblée. Job Windows réussi : TypeScript/Vite, tests Node et Rust identité,
compilation native MSVC. Setup signé et installation vérifiés avec succès.

Fichiers principaux : `client/src/App.tsx`, `client/src/YouTubePanel.tsx`,
`client/src/youtube.ts`, `client/src/Screens.tsx`, `client/src/style.css` ;
scénarios `tools/ui-check/run.mjs` et `tools/ui-check/youtube.mjs`.
Les manifests, versions et captures UI sont aussi mis à jour.

[Signed releases 37302758480](https://github.com/Mamaad/Licra-voice/actions/runs/37302758480) :
Linux, Windows et publication réussis. Vérification signature et installation
Windows réussie : dossier par défaut, second disque avec espaces, chemin de
mise à jour et conservation d’AppData.

Release : [Licra 0.3.1](https://github.com/Mamaad/Licra-voice/releases/tag/v0.3.1).
Setup : [Licra_0.3.1_x64-setup.exe](https://github.com/Mamaad/Licra-voice/releases/download/v0.3.1/Licra_0.3.1_x64-setup.exe),
5 418 770 octets. Vérification indépendante du fichier téléchargé publiquement :
signature valide et fichier altéré rejeté. Le manifeste public `latest.json`
annonce 0.3.1, le même fichier et sa signature correspondante. Le bouton
« Mettre à jour Licra » utilise ce manifeste.

Serveur de production laissé en 0.3.0 compatible, contrôle HTTP sain et contrôle
média réussi, services contrôle/LiveKit actifs, un client connecté lors du
contrôle final. Aucun service redémarré et aucune migration de production.
