# Schéma proposé avant migration — phase 2

Stack conservée : Express + JavaScript, PostgreSQL 16, API JSON `/api/v1`. Ce document est écrit avant exécution des migrations. Aucune migration n’est lancée contre les conteneurs ou bases existants.

| Table | Rôle et contraintes |
| --- | --- |
| organizations | espace SaaS privé, nom, fuseau Africa/Tunis, délai par défaut |
| users | identité Google (`sub` unique), e-mail vérifié unique, nom |
| memberships | clé organisation/utilisateur, rôle admin/member, état actif |
| invitations | organisation, e-mail normalisé, rôle, empreinte du jeton, expiration, acceptation/révocation |
| sessions | empreinte de jeton opaque, utilisateur, organisation active, CSRF, expiration |
| oauth_states | état OAuth à usage unique, nonce, PKCE, empreinte cookie navigateur, expiration |
| companies | entreprise suivie, responsable membre de la même organisation, archivage |
| contacts | personne, entreprise nullable, responsable, archivage |
| contact_emails | plusieurs adresses possibles, unicité e-mail par organisation |
| notes | texte partagé et auteur, contact ou entreprise |
| followups | échéance, objet, contact et entreprise, responsable, statut, report et annulation |
| activities | journal des actions de l’équipe, acteur, date, métadonnées minimales |
| contact_card_images | image privée en base, taille limitée, accès soumis à l’organisation |

Toutes les clés métier sont UUID ; les références entre fiches sont composites `(organization_id, id)` et interdisent les liens inter-organisations. Les notes, activités et fichiers suivent les suppressions de leurs fiches ; le journal garde des résumés minimaux. L’administrateur seul supprime définitivement ; les collaborateurs créent, modifient, archivent et travaillent sur toutes les fiches de leur organisation.

Isolation : session authentifiée → adhésion active vérifiée → transaction → `set_config('app.organization_id', ..., true)` → requêtes paramétrées et politiques RLS forcées. Le rôle applicatif n’est ni superutilisateur, ni propriétaire des tables, ni BYPASSRLS. Les migrations utilisent une connexion administrative distincte. Aucune donnée métier n’est accessible sans contexte d’organisation, y compris après réutilisation d’une connexion du pool.

Google OIDC uniquement (`openid email profile`), état + nonce + PKCE, validation serveur du jeton Google, e-mail vérifié, invitation préalable ; aucun scope Gmail. Cookies HttpOnly/SameSite, Secure en production, jetons hachés en base. L’API accepte aussi le même jeton opaque en Bearer afin de permettre un futur client natif ; aucun client Android n’est implémenté.

Ajout proposé avant la migration 003 : `contacts.source`, texte facultatif renseigné manuellement, pour alimenter le graphique d’origine des contacts demandé dans la dernière référence. Aucune origine n’est déduite ou inventée.

Migration 004 proposée pour les fiches centrales : ajout de `company_id` et `contact_id` comme contexte historique sur les activités, avec index d’historique. Ces identifiants sont des instantanés et ne disparaissent pas lors de la suppression d’une note/relance. Le serveur les déduit des fiches autorisées ; le client ne peut pas les fournir. Les politiques RLS existantes restent appliquées. Les événements anciens ne sont rattachés que lorsque leurs fiches existent encore, sans inventer de contexte disparu.

## Migration 005 — identité gérée par Better Auth

Le schéma précédent est étendu sans supprimer de donnée CRM : `users` reçoit les champs de vérification, image, nom d’entreprise et mise à jour ; `google_sub` devient nullable. Better Auth gère `auth_accounts`, `auth_sessions`, `auth_verifications`. Les identités Google antérieures sont rattachées à `auth_accounts`. Les anciennes sessions sont révoquées et l’ancien rôle applicatif ne peut plus lire `legacy_sessions` ou `oauth_states`. Les espaces/adhésions/invitations et la RLS métier restent en place. Les mots de passe et protocoles de vérification sont intégralement délégués au fournisseur. Les invitations utilisent SMTP ; Mailpit est configuré uniquement pour le développement local.
