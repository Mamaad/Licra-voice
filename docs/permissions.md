# Permissions

Rôles par défaut : Owner, Administrator, Moderator, Member, Guest.
Guest est attribué à une identité lors de sa connexion. Il permet de voir le
serveur, rejoindre/déplacer soi-même et parler. Member possède la même base ;
Moderator ajoute déplacement d’autres utilisateurs, mute, kick et vue des
rôles. Administrator possède les permissions atomiques, avec les protections
spécifiques du rôle Owner. Owner est global et protégé contre édition/suppression.
Seul un Owner attribue ou retire Owner ; le dernier Owner ne peut être retiré.
Un Administrator ne peut pas expulser/bannir/muter un Owner.

Chaque attribution est SERVER (`channel_id=''`) ou CHANNEL (UUID incluant
les descendants). Les rôles limités à un salon ne donnent aucun droit global.
Les overrides de salon s’appliquent sur toute la chaîne des parents.
Toutes les décisions applicables sont collectées : DENY > ALLOW > INHERIT.
INHERIT ne crée pas un droit. Sans ALLOW, l’opération est refusée.
Une autorisation plus profonde ne peut pas annuler un DENY explicite d’ancêtre.

Les permissions stables figurent dans le schéma partagé, package Go
`permissions` et écran Administration. Les permissions futures sont inactives
puisque les capacités correspondantes ne sont pas annoncées.
La priorité de speaker est réservée comme droit ; la V1 ne modifie pas les
flux des autres speakers pour donner une priorité acoustique.

Le serveur vérifie chaque commande. Le client utilise les cartes de permissions
pour masquer/désactiver les actions, ce qui n’est pas une frontière de sécurité.
Déplacer autrui requiert `channel.move_others` sur source et destination ;
la cible doit avoir `channel.join` sur la destination. Capacité/mot de passe
peuvent être contournés uniquement avec les permissions correspondantes.
Le changement de rôle/override révoque immédiatement l’accès vocal perdu et
met à jour les permissions de publication LiveKit.

L’écran Administration permet de créer/éditer/supprimer des rôles, attribuer
à une identité connectée ou connue hors ligne, choisir le scope et appliquer
des exceptions ALLOW/DENY/INHERIT. Les fingerprints restent complets : les
abréviations d’affichage ne servent jamais de clé d’autorisation.
