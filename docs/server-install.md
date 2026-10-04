# Ubuntu 24.04 x86_64

Télécharger le bundle officiel et contrôler `checksums-linux.txt` obtenu via
HTTPS depuis la même release. Décompresser et lancer `scripts/install-server.sh`
sans sudo. Le bundle contient le serveur compilé ; LiveKit 1.13.7 est téléchargé
sur sa release officielle avec SHA256 épinglé si absent. Aucun build Go sur un
serveur fraîchement installé n’est nécessaire avec ce bundle.

Chemins : `~/.local/bin/{licra-server,livekit-server}`,
`~/.config/licra/{config.toml,livekit.yaml}`,
`~/.local/share/licra/{licra.db,bootstrap.seed}` et `~/.local/state/licra`.
Config, DB et seed privés 0600. Les services sont dans `~/.config/systemd/user`.
Le service serveur dépend du service LiveKit. Aucun processus du projet ne
s’exécute root. L’installateur refuse root et ne modifie aucun pare-feu.

```bash
systemctl --user status licra-livekit licra-server
journalctl --user -u licra-server -u licra-livekit -f
~/.local/bin/licra-server admin-token
~/.local/bin/licra-server admin-token --regenerate
./scripts/doctor.sh
```

Le bootstrap est affiché une fois au premier lancement. Le DB conserve son
hash SHA-256 et son état consommé. Une seed locale 0600 permet au propriétaire
Unix de le retrouver par HMAC ; elle est supprimée après claim. Régénérer
invalide le précédent et autorise un nouveau claim, même avec un Owner existant.

`Linger=no` : les services utilisateur peuvent s’arrêter à la fermeture de la
session et ne sont pas garantis au boot. Un administrateur système peut
faire `sudo loginctl enable-linger NOM_UTILISATEUR`. Licra ne le fait pas.
Sans bus systemd user, démarrer manuellement les deux processus dans un
superviseur utilisateur. Aucun fallback crontab n’est ajouté : éviter deux
superviseurs concurrents et préférer systemd pour le démarrage robuste.

Ports : BASE_PORT TCP, base+1 UDP mux, base+2 TCP fallback. Le port signaling
interne 7880 est loopback et ne doit pas être ouvert publiquement. Pas de plage
50000–60000. Les ports explicites `media_udp_port`/`media_tcp_port` peuvent
être changés dans config.toml ; `licra-server ports` affiche les valeurs réelles.
Le client ne saisit qu’une adresse `IP:BASE_PORT`.

`livekit.public_ip` permet une IPv4 explicite si la détection STUN est
inadaptée. Le trafic RTC écoute les interfaces réseau indépendamment du
HTTP loopback. Après édition, arrêter les deux services, exécuter
`licra-server init-config`, puis redémarrer LiveKit et le serveur.
Les modifications manuelles de livekit.yaml sont remplacées par ce générateur.
Le bloc `[turn]` est facultatif et désactivé : `enabled`, `domain`, `udp_port`
(3478), `tls_port` (5349), `cert_file`, `key_file`. Son activation ajoute des
ports/certificats propres et peut nécessiter une plage de ports relais TURN ;
consulter LiveKit avant configuration. Le trajet direct UDP reste la référence V1.

TLS facultatif : définir `server.tls_cert` et `server.tls_key`, puis connecter le
client avec `https://domaine:BASE_PORT`. Le signaling devient WSS sur ce même
port. Un reverse proxy TLS peut aussi être utilisé sans exposer le port interne.
Ne pas activer `allow_plain_ip_connection=false` sans certificat.

Mise à jour serveur : `scripts/update-server.sh ./licra-server ./checksums-server.txt`.
Le serveur est arrêté avant la copie cohérente DB/WAL ; sauvegarde horodatée,
remplacement atomique du binaire et contrôle health. TLS nécessite une URL de
health HTTPS valide dans `LICRA_HEALTH_URL`. Redémarrer LiveKit séparément
si sa version change. Désinstaller conserve les données ; `--purge` demande
une confirmation explicite.

Voir la [configuration officielle LiveKit](https://github.com/livekit/livekit/blob/v1.13.7/config-sample.yaml)
et [les ports RTC](https://docs.livekit.io/transport/self-hosting/ports-firewall/).
