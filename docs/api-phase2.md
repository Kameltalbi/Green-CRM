# API Ciblix

## Identité gérée par Better Auth

Base `/api/auth`. Endpoints du fournisseur : `POST /sign-up/email`, `/sign-in/email`, `/sign-in/social`, `/send-verification-email`, `/request-password-reset`, `/reset-password`, `/sign-out` ; vérification d’adresse et callback Google gérés par le fournisseur. Le client n’implémente ni hachage ni protocole de mot de passe. Les URL de retour sont validées par Better Auth.

La session web utilise le cookie signé `ciblix.session_token` (préfixe sécurisé en production). Un futur client natif peut utiliser le Bearer signé retourné par le fournisseur dans `set-auth-token` après connexion. Aucun token de test ni token non signé n’est accepté.

## Création d’espace et invitations

- `GET /api/public/auth-config` : disponibilité e-mail/Google ; lien Mailpit seulement en développement local.
- `GET /api/public/invitations/:token` : aperçu nominatif d’un lien valide ; 410 si expiré/révoqué/utilisé.
- `GET /api/v1/account` : utilisateur vérifié, organisations actives, nom d’entreprise saisi, CSRF ; fonctionne avant création d’espace.
- `POST /api/v1/onboarding` : `{companyName}` ; espace initial, créateur administrateur, idempotent et transactionnel.
- `POST /api/v1/invitations/accept` : `{token}` ; identité vérifiée, adresse exacte, lien à usage unique et non expiré ; pas de nouvel espace.

## API métier versionnée

Base `/api/v1`, JSON UTF-8, UUID, dates ISO 8601 avec fuseau. Chaque requête exige une identité vérifiée et une adhésion active. Les écritures par cookie exigent l’origine exacte `APP_URL` et `X-CSRF-Token`, obtenu par `/account` ou `/me`.

| Méthode | Route | Contenu et droits |
| --- | --- | --- |
| GET | `/me` | identité, organisation active, adhésions propres, membres, CSRF |
| POST | `/auth/logout` | révoque la session via Better Auth |
| POST | `/organizations/switch` | `{organization_id}` ; adhésion active requise |
| GET | `/state` | aperçu de compatibilité, 50 éléments/type et `pagination` avec totaux ; plus utilisé par l’interface |
| GET | `/companies`, `/contacts`, `/notes`, `/followups` | `{items,total,limit,offset,related}` ; limit 1–200, offset entier positif ou nul |
| GET | `/companies/:id`, `/contacts/:id`, `/notes/:id`, `/followups/:id` | fiche de l’organisation, sinon 404 |
| GET | `/companies/:id/history`, `/contacts/:id/history` | `{items,total,limit,offset,gmailConnected}` ; `gmailConnected` indique un compte Gmail actif de l’utilisateur ; limite 1–100, défaut 25 |
| GET | `/gmail/accounts` | comptes Gmail de l’organisation (sans jeton) ; `{configured,consentNotice,accounts,mine}` |
| POST | `/gmail/connect` | démarre OAuth ; corps `{share_consent:true}` obligatoire ; `{url}` ; 503 si non configuré |
| GET | `/gmail/callback` | retour Google, redirection vers les paramètres |
| POST | `/gmail/accounts/:id/default` | compte expéditeur par défaut de l’utilisateur |
| POST | `/gmail/accounts/:id/sync` | synchronisation manuelle (propre compte, ou admin) ; `{full?:boolean}` |
| DELETE | `/gmail/accounts/:id` | déconnexion, purge des messages synchronisés du compte, révocation |
| GET | `/contacts/:id/emails`, `/companies/:id/emails` | historique synchronisé partagé ; `q`, `limit`, `offset`, `owner_user_id` |
| GET | `/gmail/synced/:id` | détail d’un message synchronisé de l’organisation |
| POST | `/gmail/messages` | envoi Gmail depuis le propre compte ; historique seulement après confirmation |
| POST/PATCH | `/companies`, `/companies/:id` | nom, secteur, ville, description, responsable ; PATCH : archivage |
| POST/PATCH | `/contacts`, `/contacts/:id` | nom, entreprise nullable, fonction, téléphone, origine, responsable, adresses ; PATCH : archivage |
| DELETE | `/companies/:id`, `/contacts/:id` | administrateur uniquement |
| POST/PATCH/DELETE | `/notes`, `/notes/:id` | texte partagé lié à une fiche ; DELETE administrateur |
| POST/PATCH/DELETE | `/followups`, `/followups/:id` | échéance, responsable, objet, statut, annulation, brouillon local ; DELETE administrateur |
| POST | `/contacts/:id/card` | `{mime_type,data}` base64, PNG/JPEG/WebP, 8 Mo |
| GET | `/images/:id` | image privée, authentifiée et isolée |
| GET/POST | `/invitations` | administrateur ; création `{email,role?}` envoie le mail et retourne `{id,email,role,expires_at,sent:true}` sans secret |
| DELETE | `/invitations/:id` | administrateur ; révocation |
| PATCH | `/members/:id` | administrateur ; `{role?:admin/member,active?:boolean,transfer_to?:uuid}` ; dernier admin protégé, transfert exigé si désactivation avec responsabilités |

Les identifiants d’organisation/auteur et les champs système sont refusés dans les corps métier. Le contexte vient de la session, jamais d’un en-tête libre. Une désactivation retire les sessions de cet espace. Les membres de la même organisation partagent toutes ses fiches ; l’isolation serveur et RLS s’applique aux autres organisations.

Erreurs : `{message}` en français pour l’API métier ; les codes fournisseur sont traduits par l’interface. Codes usuels : 400 validation, 401 session, 403 droits/vérification/CSRF, 404 invisible/inexistant, 409 doublon ou contrainte, 410 invitation périmée, 413 capacité/taille, 429 limitation, 503 envoi indisponible.

L’envoi et la synchronisation Gmail sont un flux OAuth distinct de Better Auth (`gmail.send` + `gmail.readonly`). Voir [gmail-readonly-oauth.md](./gmail-readonly-oauth.md). Les messages synchronisés liés aux contacts sont partagés dans l’organisation ; l’envoi reste personnel. Le client Android natif est décrit dans [android/README.md](../android/README.md).

## Pagination serveur et contexte — Lot 1

- Contacts/entreprises : `q` (recherche insensible à la casse et aux accents français usuels), `owner` (UUID ou `unassigned`), `sector`, `status` (`late`, `planned`, `none`, `done`, `archived`), `archived=true`, `sort` (`name`, `relation`, `owner`, `next`, `status`), `direction=asc|desc`. L’UUID départage les égalités. `company_id` filtre les contacts d’une entreprise.
- Notes : `company_id` ou `contact_id`, tri chronologique décroissant avec UUID en départage.
- Relances : `company_id`, `contact_id`, `owner`, `status=pending|completed|cancelled`, `scope=today|late|upcoming`, tri par échéance puis UUID. Les périodes restent en heure de Tunis avant le Lot 2.
- `related` contient seulement les entreprises, contacts, coordonnées et métadonnées d’image associés à la page. Les images binaires gardent leur endpoint privé.
- `GET /contacts/:id/context`, `/companies/:id/context` : `{record,related,followupTotal}` ; contexte d’une fiche et trois prochaines relances maximum. Notes, interlocuteurs et historique se paginent séparément.
- `GET /dashboard` : compteurs complets, évolution sur douze mois, origines regroupées au-delà de dix-neuf catégories, six premiers secteurs, pages de dix relances par période avec leurs totaux.
- `GET /directory-facets` : jusqu’à 200 suggestions de secteurs ; le champ accepte également la saisie exacte d’un autre secteur.
- `GET /contacts/export` : téléchargement CSV de tous les contacts actifs ; mêmes filtres et tris que `/contacts`, `limit`/`offset` ignorés volontairement. Un curseur PostgreSQL lit 200 lignes à la fois. Cellules pouvant être interprétées comme des formules neutralisées. L’interface propose tous les contacts actifs ou les filtres du répertoire courant.

Le transfert de responsabilités est transactionnel, réservé aux administrateurs et limité à la même organisation. Le destinataire doit être actif et différent du membre désactivé. Les actions `reassigned` sont insérées dans les historiques des fiches ; la désactivation révoque les sessions de cet espace. Les changements d’attribution et les départs utilisent le même verrou d’organisation pour éviter une affectation concurrente à un membre désactivé.
