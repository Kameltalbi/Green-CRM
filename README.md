# Ciblix

CRM SaaS collaboratif français, Express/JavaScript et PostgreSQL 16. Entreprises clientes isolées, contacts et relances partagés entre collaborateurs autorisés. Le module d’authentification utilise **Better Auth**, et non une connexion simulée.

## État de l’environnement local

- Application : http://localhost:3000.
- **E-mails de test : http://localhost:8026.** Mailpit intercepte vérifications, invitations et réinitialisations. Rien n’est envoyé dans Gmail ni sur Internet avec cette configuration.
- Google : implémenté par Better Auth, mais indisponible tant que le client OAuth n’est pas configuré.
- PostgreSQL : conteneur `ciblix-phase2-postgres`, port privé local 55439, volume `ciblix_phase2_pgdata`. Aucun autre conteneur/base n’est utilisé.
- Aucun abonnement ni service cloud payant créé. L’envoi Gmail utilise un client OAuth distinct ; la lecture de la boîte n’est pas implémentée. Un premier client Android natif est disponible dans [android/](android/README.md).

## Installer et lancer

Node.js 22+, Docker, `npm install`.

Sur une nouvelle machine : `npm run db:local`, puis `npm run auth:local`. La première commande prépare PostgreSQL et les connexions privées, la seconde génère un secret stable et prépare Mailpit. Ces commandes ne doivent pas écraser un `.env` déjà configuré. Les identifiants locaux restent dans des fichiers ignorés par Git.

`npm run db:migrate`, puis `npm start`.

La connexion applicative `DATABASE_URL` doit utiliser un rôle non propriétaire, non superutilisateur et sans BYPASSRLS. La connexion administrative distincte `MIGRATION_DATABASE_URL` sert aux migrations. Le serveur refuse un rôle applicatif privilégié.

Ne supprimez pas le volume PostgreSQL : les données sont conservées au rechargement et au redémarrage grâce à ce volume. Des sauvegardes séparées restent nécessaires avant une exploitation réelle.

## Inscription, connexion et invitations

La homepage propose **Créer un compte** et **Se connecter**.

- `/inscription` : nom, e-mail professionnel, mot de passe et confirmation. Google est masqué tant que le fournisseur n’est pas configuré.
- `/verification-email` : vérification obligatoire pour les comptes e-mail/mot de passe, renvoi possible.
- `/bienvenue` : nom de l’entreprise et création de l’espace après vérification ; le créateur devient administrateur. Les comptes ayant déjà un nom d’entreprise prérempli conservent la création automatique et idempotente.
- `/connexion` : formulaire centré e-mail/mot de passe, déconnexion et sessions révocables. Google n’apparaît que si le fournisseur est configuré. Français et anglais disponibles via le sélecteur de langue des pages d’authentification.
- `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe` : lien de réinitialisation à durée limitée, usage unique, révocation des sessions après changement.
- `/invitation?token=...` : invitation nominative à une organisation existante, inscription/connexion puis acceptation explicite. Les invitations expirées, révoquées, déjà acceptées ou destinées à une autre adresse sont refusées.

Les administrateurs invitent leurs collaborateurs depuis **Membres et accès**. Un e-mail est transmis par SMTP ; aucun lien secret n’est exposé dans les listes d’invitations. Tous les membres actifs partagent les contacts, entreprises, notes et relances de leur organisation. Seuls les administrateurs suppriment définitivement et gèrent les rôles ; le dernier administrateur actif ne peut pas être retiré.

Pour un premier espace, l’inscription publique remplace désormais l’ancienne obligation d’invitation préalable. La commande `npm run invite:admin -- adresse@exemple.tn "Nom de l’organisation"` reste un outil administratif facultatif de création d’une organisation/invitation, pas un endpoint public.

## Configurer les e-mails et Google réels

Renseigner dans `.env` les variables SMTP du fournisseur que vous avez autorisé : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`. Sans SMTP, les actions qui nécessitent un e-mail échouent explicitement. Mailpit est une boîte de développement, pas un service de livraison externe. En production, TLS et une adresse d’expéditeur appropriée sont nécessaires.

Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`. L’URI de redirection à enregistrer dans Google est désormais :

`http://localhost:3000/api/auth/callback/google`

En production, remplacer l’origine par celle d’`APP_URL`, en HTTPS. Seuls les scopes d’identité `openid email profile` sont utilisés. Ce client ne sert pas à Gmail.

L’envoi Gmail utilise d’autres variables : `GMAIL_GOOGLE_CLIENT_ID`, `GMAIL_GOOGLE_CLIENT_SECRET` et `GMAIL_GOOGLE_REDIRECT_URI`. En production, l’URI est `https://ciblix.com/api/v1/gmail/callback` et l’origine JavaScript autorisée est `https://ciblix.com`. Le flux demande `gmail.send` pour l’envoi, ainsi que `openid` et `email` uniquement pour reconnaître l’adresse choisie. Il ne lit pas la boîte. Chaque utilisateur connecte ses comptes depuis Paramètres → Comptes e-mail, puis écrit depuis une fiche. Les jetons restent chiffrés côté serveur.

`BETTER_AUTH_SECRET` doit être aléatoire, stable et d’au moins 32 caractères. Ne pas le modifier à chaque lancement, le publier ou l’inclure dans une capture. La migration 005 conserve les utilisateurs/données CRM et révoque les anciennes sessions.

## Modules métiers

- `/app` : dashboard de suivi, statistiques calculées en base, relances du jour, en retard et à venir.
- `/app/contacts` : tableau Entreprises/Contacts, recherche, filtres, tri, pagination, archivage/restauration, création/modification/suppression selon les droits. `?vue=entreprises` ouvre l’onglet Entreprises.
- `/app/entreprises/:id` : coordonnées des interlocuteurs, notes, historique chronologique paginé, prochaines relances.
- Contacts : panneau latéral avec coordonnées, notes, historique, relances et carte de visite privée.
- `/app/relances` : échéances, responsable, report, clôture, annulation et brouillon local persistant, sans envoi Gmail.

Adresses e-mail normalisées et uniques par organisation ; plusieurs adresses possibles par contact ; contact sans entreprise possible. Export CSV protégé contre les cellules interprétées comme des formules. Photos de carte de visite PNG/JPEG/WebP privées, 8 Mo maximum, saisie manuelle sans OCR payant.

Aucun devis, facture, revenu, pipeline complexe ou e-mailing de masse. Les espaces Gmail non fonctionnels sont masqués dans les vues métier ; les brouillons restent des textes enregistrés dans Ciblix, sans envoi.

## Architecture et sécurité

Better Auth gère les mots de passe, les comptes d’identité, les vérifications et les sessions. Les tables sont mappées au schéma PostgreSQL : `users`, `auth_accounts`, `auth_sessions`, `auth_verifications`, puis `organizations`, `memberships`, `invitations` pour le contexte SaaS. La cryptographie des mots de passe n’est pas développée par Ciblix.

Cookies HttpOnly, SameSite et Secure en HTTPS ; cache de session désactivé pour vérifier la révocation ; origine et CSRF vérifiés pour les écritures métier par cookie. L’API accepte les Bearer **signés par Better Auth**, sans retomber sur un cookie si un Bearer invalide est fourni. Aucun mot de passe ou jeton n’est stocké dans le navigateur par le client Ciblix.

Les routes privées sont protégées côté serveur. Chaque opération métier revalide l’adhésion active. Les clés étrangères composites et les politiques PostgreSQL RLS forcées empêchent les liens/accès entre organisations. Le contexte de transaction est effacé à sa fermeture avant réutilisation du pool. L’ancienne API JSON anonyme est supprimée. Le fichier `data/customers.json` n’est pas importé.

L’API JSON `/api/v1` est réutilisable par un futur client Android ; le client [Android](android/README.md) utilise les sessions Bearer signées et Android Keystore. Le parcours OAuth Google natif reste à développer. Voir [docs/api-phase2.md](docs/api-phase2.md).

## Design system et validation de lisibilité

Inter est auto-hébergée avec sa licence libre. Une feuille CSS lisible remplace les anciennes règles locales accumulées : corps 16 px, secondaires/labels/tableaux 14–16 px, champs/boutons 16 px, sections 22–28 px, titres 36–40 px. Les tailles ne diminuent pas sur mobile ou au zoom.

Palette : texte `#1F2937`, secondaire `#475569`, bleu `#013BE5`, vert `#07C00D`, fond `#F5F7FC`, cartes blanches, bordures `#D5DCEB`. Les mêmes règles de composants sont appliquées partout. La refonte n’ajoute pas de fonctionnalité.

Voir [docs/rapport-lisibilite.md](docs/rapport-lisibilite.md) pour l’audit, les résultats et les limites de mesure.

## Tests

- `npm test` : contrats CSS/contrastes et intégration PostgreSQL réelle sur une base temporaire supprimée après test. Isolation, partage, CRUD, droits, CSRF, invitations envoyées au transport de test, historique complet, inscription, vérification, création d’espace, connexion et réinitialisation Better Auth.
- `npm run test:ui` : Chromium local, parcours métiers et authentification complets, captures et absence de débordement. Utiliser `CHROME_BIN=/chemin/chrome` si Chrome n’est pas installé à son emplacement macOS standard.
- `npm run test:visual` : 13 vues × 4 largeurs (390/768/1440/1920) × 2 zooms (100/200), axe-core WCAG AA, contraste calculé sur les couleurs rendues, minimum 14 px et absence de débordement.
- `npm run audit:css` : analyse de toutes les règles de la feuille, y compris media queries.

Les captures et rapports locaux sont dans `test-results/` (ignoré par Git). `VISUAL_PHASE=before` conserve les captures de référence ; ne le relancer qu’en voulant remplacer cette référence. Les tests utilisent leurs propres bases, sessions et e-mails ; aucune route de connexion de test n’est exposée par l’application.

## Limites avant commercialisation

Configurer et valider le SMTP de production et Google, puis préparer HTTPS, secrets, sauvegardes/restauration, supervision et revue de sécurité. L’application n’est pas déployée publiquement. Aucun fournisseur payant n’est souscrit sans accord.

Les répertoires, les relances, les notes et les contacts d’une entreprise utilisent la pagination serveur. Le dashboard reçoit des agrégats et dix relances maximum par période ; les fiches chargent leur contexte à la demande. Les sélecteurs proposent une recherche serveur et les exports CSV parcourent toutes les pages côté serveur. L’ancien `/state` reste disponible comme aperçu borné de compatibilité (50 éléments par collection et totaux), sans être utilisé par l’interface.

Les données sont actualisées au retour dans l’application, via le bouton Actualiser et après les mutations. Une saisie en cours diffère le rafraîchissement de l’interface. Le partage ne promet pas de synchronisation temps réel. La désactivation d’un membre responsable exige un transfert vers un autre membre actif de l’organisation : contacts, entreprises et relances ouvertes sont réattribués, avec historique conservé ; les relances terminées et annulées conservent leur responsable historique.

La migration 006 ajoute seulement des index. Exécuter `npm run db:migrate` avant le redémarrage local ou un déploiement autorisé. Le détail de la recette et les limites du Lot 1 figurent dans [docs/lot1-stabilisation.md](docs/lot1-stabilisation.md).

La lecture et la synchronisation de la boîte Gmail restent hors périmètre. L’envoi depuis un compte connecté est disponible. Les brouillons de relance restent locaux, sans envoi automatique. Le périmètre du premier client Android est décrit dans [android/README.md](android/README.md). Les anciennes maquettes `pages.js`, `compliance.js`, `dashboard.js` ne sont plus chargées. Les clients actifs sont `app.js` (composants publics), `auth-ui.js` et `live.js`.

## Homepage publique

La vitrine est une landing commerciale : navigation, hero avec la photographie de l’équipe, bénéfices, fonctions, parcours, publics, raisons de choisir Ciblix, FAQ et appel à l’action. Aucune capture du CRM n’est affichée. Le français et l’anglais suivent la préférence `ciblix.language`. L’import de contacts n’est pas annoncé : il n’est pas disponible.

Le contenu est pré-rendu dans `public/index.html` : exécuter `npm run build` après toute modification de `public/homepage.js`. La feuille `public/homepage.css` complète le système commun uniquement pour la mise en page publique. Aucun backend ni écran métier n’est modifié par cette page. `npm run test:homepage` contrôle les liens, la langue, le responsive et les contrastes.

La refonte ciblée des pages d’authentification est documentée dans [docs/refonte-auth.md](docs/refonte-auth.md). Les dictionnaires FR/EN et la préférence de langue sont centralisés dans `public/i18n.js` ; les autres modules restent en français.
