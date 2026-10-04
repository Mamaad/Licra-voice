# Client Windows

Node 22+, Rust stable, Visual Studio Build Tools (Desktop development with C++)
et WebView2 Runtime sur Windows 10/11 x86_64.

```powershell
cd client
npm ci
npm run build
npm test
npm run tauri dev
npm run tauri build -- --no-bundle
```

`npm run tauri build -- --bundles nsis` produit le setup per-user ; signature
updater nécessaire si `createUpdaterArtifacts=true`. Voir releasing.md.
Le setup utilise LocalAppData et le registre HKCU, sans UAC pour l’installation
Licra. Le bootstrap WebView2 Microsoft peut nécessiter des conditions externes
si ce runtime manque sur une ancienne installation de Windows ; tester le
scénario d’installation sur une VM Windows propre. Un Runtime WebView2 déjà
installé évite cette étape externe.

Identité persistante : app_data_dir de Tauri, fichier `identity.dpapi`, protégée
par CryptProtectData (utilisateur Windows courant). Une mise à jour ne l’efface
pas. Une désinstallation interactive demande explicitement de conserver
identité/paramètres ; la désinstallation silencieuse les conserve.
Export AES-256-GCM avec clé Argon2id et passphrase >=10 caractères. L’import
vérifie version, taille et authentification du backup avant remplacement ;
l’ancienne identité protégée est conservée sous `.previous`.
Le fallback de développement Linux utilise un fichier 0600, sans DPAPI ; il
n’est pas la distribution cible.

Les options voix utilisent les API du SDK : mono 48 kHz, presets 24/32/64 kbps,
DTX, RED, DSP du navigateur. L’activation vocale analyse le microphone local,
avec seuil configurable et maintien de 250 ms. Le PTT global utilise le plugin
Tauri officiel, avec événements appui/relâchement. Le micro démarre coupé en
PTT/activation. Deafen coupe aussi la publication locale ; mute/volumes d’un
participant sont locaux. WebAudio autorise un gain 0–200 %.

Tests Rust des backups sans bibliothèques GUI :
`cargo test --manifest-path client/src-tauri/Cargo.toml --no-default-features --lib`.
La CI `windows-latest` compile réellement le client Tauri, en plus du build React.
