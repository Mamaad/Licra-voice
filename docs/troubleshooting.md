# Dépannage

- Pas de connexion : `scripts/doctor.sh`, `curl http://127.0.0.1:64738/health`,
  vérifier BASE_PORT TCP dans le pare-feu fournisseur et le NAT. Tester depuis
  un réseau externe, pas seulement en loopback.
- Présences visibles sans voix : vérifier `licra-livekit.service`, le YAML,
  l’UDP base+1 et TCP base+2, `livekit.public_ip`, autorisation micro WebView2.
  Le SFU écoute les interfaces réseau ; utiliser une IP non loopback pour les
  tests RTC. `licra-server media-health` vérifie l’API locale.
- LiveKit refuse YAML : n’ajouter que les champs pris en charge par la version
  épinglée ; le renderer n’utilise ni Redis ni plages UDP.
- Boot/logout : vérifier `loginctl show-user "$USER" -p Linger` et demander à
  l’administrateur système d’activer linger si nécessaire.
- Identity already connected : fermer l’ancien client ; une installation
  exportée ne doit pas être utilisée simultanément sur deux postes.
- Microphone PTT : raccourci valide de type `Control+Space`, libérer une touche
  réservée par une autre application ; erreur affichée si l’enregistrement échoue.
- Mot de passe du salon : 72 octets maximum bcrypt, pas 72 caractères Unicode.
- Permission refusée : vérifier les rôles, scopes et DENY sur chaque ancêtre.
  Un ALLOW enfant ne neutralise pas un DENY parent.
- Salons non supprimables : supprimer d’abord les descendants et déplacer les
  participants ; le serveur refuse les suppressions occupées.
- Owner perdu : récupérer la sauvegarde d’identité chiffrée, ou régénérer le
  bootstrap depuis le compte Unix propriétaire, puis attribuer à l’identité voulue.
- Update 404 : vérifier que la release publique contient latest.json et le setup
  signé au nom utilisé dans le manifeste. Une première release doit être publiée.
- Signature updater refusée : vérifier que la build utilise la clé privée
  correspondant à la clé publique intégrée ; ne jamais désactiver la vérification.
- Niveau serveur bas mais pertes audio : mesurer débit sortant, pertes UDP,
  buffers réseau du noyau ; les changements sysctl nécessitent un administrateur,
  l’installateur n’en applique pas.
