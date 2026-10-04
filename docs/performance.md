# Mesures et capacité

`tools/loadtest` simule des challenges Ed25519 et PING/PONG sans média.

```bash
cd tools/loadtest
go build -o ../../bin/licra-loadtest .
../../bin/licra-loadtest --url ws://127.0.0.1:64738/ws --clients 50 --duration 30s --server-pid PID
```

Pour un benchmark depuis une seule IP, monter temporairement
`security.handshake_rate_limit` et `server.max_clients` sur un serveur de test.
Ne pas ouvrir ces limites sur un serveur public pour un benchmark.
Les CPU/RAM utilisent `/proc/PID/stat` localement, CPU exprimé par cœur (100 %
= un cœur). Sans PID, les champs CPU/RAM ne sont pas mesurés. Latences p50/p95
mesurées sur PING/PONG, événements reçus comptés. Une erreur fait échouer l’outil.

Mesure locale réelle du 4 octobre 2026 : `docs/benchmarks/control-local.json`,
50 sessions, 10 secondes, aucun audio. Elle caractérise ce poste et cette durée,
pas le Xeon cible ni la capacité maximale. Refaire au moins 30 minutes sur la
machine cible avec différentes tailles de salons et locuteurs avant dimensionnement.

Pour N participants dans un salon, S locuteurs simultanés et bitrate B,
l’ordre de grandeur du trafic audio sortant est S × (N−1) × B, hors en-têtes
RTP/UDP/IP, RED, RTCP, retransmissions et chiffrement. Une distribution de
plusieurs salons peut réduire les destinataires. La SFU ne fait aucun
transcodage ou mix ; le débit de la carte réseau devient souvent la première
limite, mais CPU de routage/chiffrement et nombres de paquets doivent être
mesurés aussi. Aucun nombre magique d’utilisateurs n’est annoncé.

Opus mono 24/32/64 kbps avec DTX et RED. Le DSP et les niveaux restent locaux.
SQLite n’est pas écrit pour les niveaux ou chaque événement de présence.

## Partage d’écran 0.2.0

Mesures locales avec un publisher/trois viewers et deux publishers/deux viewers :
[rapport](phase-chat-screen-report.md#mesures-reproductibles) et
[données RTP/CPU complètes](benchmarks/screen-local.json). Les contraintes FPS
demandées sont distinguées des FPS synthétiques effectivement observés.
