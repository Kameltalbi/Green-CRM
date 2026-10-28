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
| GET | `/state` | état de travail de l’organisation, limite 5 000 fiches/type |
| GET | `/companies`, `/contacts`, `/notes`, `/followups` | `{items,limit,offset}` ; limit 1–200 |
| GET | `/companies/:id`, `/contacts/:id`, `/notes/:id`, `/followups/:id` | fiche de l’organisation, sinon 404 |
| GET | `/companies/:id/history`, `/contacts/:id/history` | `{items,total,limit,offset,gmailConnected:false}` ; limite 1–100, défaut 25 |
| POST/PATCH | `/companies`, `/companies/:id` | nom, secteur, ville, description, responsable ; PATCH : archivage |
| POST/PATCH | `/contacts`, `/contacts/:id` | nom, entreprise nullable, fonction, téléphone, origine, responsable, adresses ; PATCH : archivage |
| DELETE | `/companies/:id`, `/contacts/:id` | administrateur uniquement |
| POST/PATCH/DELETE | `/notes`, `/notes/:id` | texte partagé lié à une fiche ; DELETE administrateur |
| POST/PATCH/DELETE | `/followups`, `/followups/:id` | échéance, responsable, objet, statut, annulation, brouillon local ; DELETE administrateur |
| POST | `/contacts/:id/card` | `{mime_type,data}` base64, PNG/JPEG/WebP, 8 Mo |
| GET | `/images/:id` | image privée, authentifiée et isolée |
| GET/POST | `/invitations` | administrateur ; création `{email,role?}` envoie le mail et retourne `{id,email,role,expires_at,sent:true}` sans secret |
| DELETE | `/invitations/:id` | administrateur ; révocation |
| PATCH | `/members/:id` | administrateur ; `{role?:admin/member,active?:boolean}` ; dernier admin protégé |

Les identifiants d’organisation/auteur et les champs système sont refusés dans les corps métier. Le contexte vient de la session, jamais d’un en-tête libre. Une désactivation retire les sessions de cet espace. Les membres de la même organisation partagent toutes ses fiches ; l’isolation serveur et RLS s’applique aux autres organisations.

Erreurs : `{message}` en français pour l’API métier ; les codes fournisseur sont traduits par l’interface. Codes usuels : 400 validation, 401 session, 403 droits/vérification/CSRF, 404 invisible/inexistant, 409 doublon ou contrainte, 410 invitation périmée, 413 capacité/taille, 429 limitation, 503 envoi indisponible.

Les connexions Gmail et Android ne sont pas implémentées. Les historiques actuels représentent des actions Ciblix, pas des messages Gmail.
