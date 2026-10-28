# Ciblix

CRM SaaS collaboratif français, Express/JavaScript et PostgreSQL 16. Entreprises clientes isolées, contacts et relances partagés entre collaborateurs autorisés. Le module d’authentification utilise **Better Auth**, et non une connexion simulée.

## État de l’environnement local

- Application : http://localhost:3000.
- **E-mails de test : http://localhost:8026.** Mailpit intercepte vérifications, invitations et réinitialisations. Rien n’est envoyé dans Gmail ni sur Internet avec cette configuration.
- Google : implémenté par Better Auth, mais indisponible tant que le client OAuth n’est pas configuré.
- PostgreSQL : conteneur `ciblix-phase2-postgres`, port privé local 55439, volume `ciblix_phase2_pgdata`. Aucun autre conteneur/base n’est utilisé.
- Aucun abonnement ni service cloud payant créé. Gmail et Android ne sont pas intégrés.

## Installer et lancer

Node.js 22+, Docker, `npm install`.

Sur une nouvelle machine : `npm run db:local`, puis `npm run auth:local`. La première commande prépare PostgreSQL et les connexions privées, la seconde génère un secret stable et prépare Mailpit. Ces commandes ne doivent pas écraser un `.env` déjà configuré. Les identifiants locaux restent dans des fichiers ignorés par Git.

`npm run db:migrate`, puis `npm start`.

La connexion applicative `DATABASE_URL` doit utiliser un rôle non propriétaire, non superutilisateur et sans BYPASSRLS. La connexion administrative distincte `MIGRATION_DATABASE_URL` sert aux migrations. Le serveur refuse un rôle applicatif privilégié.

Ne supprimez pas le volume PostgreSQL : les données sont conservées au rechargement et au redémarrage grâce à ce volume. Des sauvegardes séparées restent nécessaires avant une exploitation réelle.

## Inscription, connexion et invitations

La homepage propose **Créer un compte** et **Se connecter**.

- `/inscription` : nom, entreprise, e-mail et mot de passe, ou Google.
- `/verification-email` : vérification obligatoire pour les comptes e-mail/mot de passe, renvoi possible.
- `/bienvenue` : création de l’espace après vérification ; le créateur devient administrateur. Le nom saisi à l’inscription permet une création automatique et idempotente ; après Google, le nom de l’entreprise peut être demandé ici.
- `/connexion` : e-mail/mot de passe ou Google, déconnexion et sessions révocables.
- `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe` : lien de réinitialisation à durée limitée, usage unique, révocation des sessions après changement.
- `/invitation?token=...` : invitation nominative à une organisation existante, inscription/connexion puis acceptation explicite. Les invitations expirées, révoquées, déjà acceptées ou destinées à une autre adresse sont refusées.

Les administrateurs invitent leurs collaborateurs depuis **Membres et accès**. Un e-mail est transmis par SMTP ; aucun lien secret n’est exposé dans les listes d’invitations. Tous les membres actifs partagent les contacts, entreprises, notes et relances de leur organisation. Seuls les administrateurs suppriment définitivement et gèrent les rôles ; le dernier administrateur actif ne peut pas être retiré.

Pour un premier espace, l’inscription publique remplace désormais l’ancienne obligation d’invitation préalable. La commande `npm run invite:admin -- adresse@exemple.tn "Nom de l’organisation"` reste un outil administratif facultatif de création d’une organisation/invitation, pas un endpoint public.

## Configurer les e-mails et Google réels

Renseigner dans `.env` les variables SMTP du fournisseur que vous avez autorisé : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`. Sans SMTP, les actions qui nécessitent un e-mail échouent explicitement. Mailpit est une boîte de développement, pas un service de livraison externe. En production, TLS et une adresse d’expéditeur appropriée sont nécessaires.

Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`. L’URI de redirection à enregistrer dans Google est désormais :

`http://localhost:3000/api/auth/callback/google`

En production, remplacer l’origine par celle d’`APP_URL`, en HTTPS. Seuls les scopes d’identité `openid email profile` sont utilisés : **aucune autorisation Gmail**. Le raccordement avec un véritable client Google reste à valider avec les identifiants du propriétaire.

`BETTER_AUTH_SECRET` doit être aléatoire, stable et d’au moins 32 caractères. Ne pas le modifier à chaque lancement, le publier ou l’inclure dans une capture. La migration 005 conserve les utilisateurs/données CRM et révoque les anciennes sessions.

## Modules métiers

- `/app` : dashboard de suivi, graphiques alimentés par les données enregistrées, relances et état Gmail non connecté.
- `/app/contacts` : tableau Entreprises/Contacts, recherche, filtres, tri, pagination, archivage/restauration, création/modification/suppression selon les droits. `?vue=entreprises` ouvre l’onglet Entreprises.
- `/app/entreprises/:id` : coordonnées des interlocuteurs, notes, historique chronologique paginé, prochaines relances.
- Contacts : panneau latéral avec coordonnées, notes, historique, relances et carte de visite privée.
- `/app/relances` : échéances, responsable, report, clôture, annulation et brouillon local persistant, sans envoi Gmail.

Adresses e-mail normalisées et uniques par organisation ; plusieurs adresses possibles par contact ; contact sans entreprise possible. Export CSV protégé contre les cellules interprétées comme des formules. Photos de carte de visite PNG/JPEG/WebP privées, 8 Mo maximum, saisie manuelle sans OCR payant.

Aucun devis, facture, revenu, pipeline complexe ou e-mailing de masse. Le dernier échange reste « Non disponible — Gmail non connecté » ; aucune réponse n’est inventée.

## Architecture et sécurité

Better Auth gère les mots de passe, les comptes d’identité, les vérifications et les sessions. Les tables sont mappées au schéma PostgreSQL : `users`, `auth_accounts`, `auth_sessions`, `auth_verifications`, puis `organizations`, `memberships`, `invitations` pour le contexte SaaS. La cryptographie des mots de passe n’est pas développée par Ciblix.

Cookies HttpOnly, SameSite et Secure en HTTPS ; cache de session désactivé pour vérifier la révocation ; origine et CSRF vérifiés pour les écritures métier par cookie. L’API accepte les Bearer **signés par Better Auth**, sans retomber sur un cookie si un Bearer invalide est fourni. Aucun mot de passe ou jeton n’est stocké dans le navigateur par le client Ciblix.

Les routes privées sont protégées côté serveur. Chaque opération métier revalide l’adhésion active. Les clés étrangères composites et les politiques PostgreSQL RLS forcées empêchent les liens/accès entre organisations. Le contexte de transaction est effacé à sa fermeture avant réutilisation du pool. L’ancienne API JSON anonyme est supprimée. Le fichier `data/customers.json` n’est pas importé.

L’API JSON `/api/v1` est réutilisable par un futur client Android ; le parcours OAuth natif et le stockage sécurisé Android ne sont pas développés. Voir [docs/api-phase2.md](docs/api-phase2.md).

## Design system et validation de lisibilité

Inter est auto-hébergée avec sa licence libre. Une feuille CSS lisible remplace les anciennes règles locales accumulées : corps 16 px, secondaires/labels/tableaux 14–16 px, champs/boutons 16 px, sections 22–28 px, titres 36–40 px. Les tailles ne diminuent pas sur mobile ou au zoom.

Palette : texte `#1F2937`, secondaire `#475569`, vert `#14532D`, fond `#F8FAF9`, cartes blanches, bordures `#CBD5D1`. Les mêmes règles de composants sont appliquées partout. La refonte n’ajoute pas de fonctionnalité.

Voir [docs/rapport-lisibilite.md](docs/rapport-lisibilite.md) pour l’audit, les résultats et les limites de mesure.

## Tests

- `npm test` : contrats CSS/contrastes et intégration PostgreSQL réelle sur une base temporaire supprimée après test. Isolation, partage, CRUD, droits, CSRF, invitations envoyées au transport de test, historique complet, inscription, vérification, création d’espace, connexion et réinitialisation Better Auth.
- `npm run test:ui` : Chromium local, parcours métiers et authentification complets, captures et absence de débordement. Utiliser `CHROME_BIN=/chemin/chrome` si Chrome n’est pas installé à son emplacement macOS standard.
- `npm run test:visual` : 13 vues × 4 largeurs (390/768/1440/1920) × 2 zooms (100/200), axe-core WCAG AA, contraste calculé sur les couleurs rendues, minimum 14 px et absence de débordement.
- `npm run audit:css` : analyse de toutes les règles de la feuille, y compris media queries.

Les captures et rapports locaux sont dans `test-results/` (ignoré par Git). `VISUAL_PHASE=before` conserve les captures de référence ; ne le relancer qu’en voulant remplacer cette référence. Les tests utilisent leurs propres bases, sessions et e-mails ; aucune route de connexion de test n’est exposée par l’application.

## Limites avant commercialisation

Configurer et valider le SMTP de production et Google, puis préparer HTTPS, secrets, sauvegardes/restauration, supervision et revue de sécurité. L’application n’est pas déployée publiquement. Aucun fournisseur payant n’est souscrit sans accord.

La vue métier charge au maximum 5 000 fiches de chaque type et les 50 dernières activités du dashboard. Le tableau pagine localement cet ensemble ; l’historique des fiches possède son endpoint paginé propre. Une pagination serveur de toute l’interface sera nécessaire au-delà de cette taille. Le partage est persistant, sans rafraîchissement temps réel annoncé.

Gmail, calcul des réponses, synchronisation et brouillons Gmail restent hors périmètre, de même qu’Android. Les anciennes maquettes `pages.js`, `compliance.js`, `dashboard.js` ne sont plus chargées. Les clients actifs sont `app.js` (composants publics), `auth-ui.js` et `live.js`.
