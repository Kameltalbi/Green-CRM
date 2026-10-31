# Gmail : scopes `gmail.send` et `gmail.readonly`

## Scopes demandés

Ciblix demande, pour la connexion Gmail (distincte de Better Auth) :

- `https://www.googleapis.com/auth/gmail.send` — envoi depuis le compte de l’utilisateur
- `https://www.googleapis.com/auth/gmail.readonly` — lecture pour synchroniser uniquement les messages associés aux contacts CRM
- `openid` et `email` — identification du compte

Les comptes déjà connectés avec seulement `gmail.send` doivent se reconnecter pour obtenir `gmail.readonly` et activer la synchronisation.

## Consentement Ciblix

Avant le redirection Google, l’utilisateur doit accepter explicitement que les échanges commerciaux synchronisés (messages liés aux contacts) soient visibles par les collaborateurs de son organisation. Ce consentement est enregistré (`share_consent` / `share_consent_at`).

## Visibilité

- Isolation stricte entre organisations (RLS + `organization_id`).
- Seuls les messages matching une adresse de contact CRM sont stockés.
- Historique unifié sur les fiches contact et entreprise, avec identification du collaborateur propriétaire du compte Gmail.
- L’envoi reste limité au propre compte Gmail de l’utilisateur.

## Obligations Google (scope restreint)

`gmail.readonly` est un **scope restreint** Google. Pour une application en production servant des utilisateurs hors du domaine de test Google Cloud :

1. Configurer l’écran de consentement OAuth (type approprié, domaines autorisés, URI de redirection exacte).
2. Soumettre l’application à la **vérification OAuth** Google pour les scopes sensibles / restreints.
3. Prévoir une **évaluation de sécurité** (souvent via le programme CASA / assessor agréé) lorsque Google l’exige pour `gmail.readonly`.
4. Respecter la [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), notamment Limited Use : pas d’usage publicitaire, pas de vente, usage limité à la fonctionnalité demandée, transferts limités.
5. Publier une politique de confidentialité à jour décrivant la lecture et le partage organisationnel des messages CRM.

Tant que la vérification n’est pas obtenue, Google peut limiter l’accès aux comptes de test listés dans la console Cloud. Ne pas déployer la synchronisation en production sans cette autorisation explicite de l’éditeur et sans le statut Google requis.

## Déploiement

La synchronisation Gmail est développée et testée en local. Aucun déploiement VPS sans autorisation explicite.
