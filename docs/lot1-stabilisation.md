# Lot 1 — Stabilisation du CRM

Compte rendu du 29 octobre 2026. Périmètre validé : conserver l’architecture et les fonctionnalités, corriger les parcours, supprimer le chargement global des données métier, actualiser les vues partagées et gérer le départ des collaborateurs. Aucun déploiement public effectué.

## Corrections livrées

### Navigateur et recette métier

La panne initiale venait de la sélection de la première cible de débogage Chrome : il s’agissait d’une extension, et non de l’onglet applicatif. La recette sélectionne désormais la cible de type `page`. La recette principale attend explicitement `about:blank` et conserve une capture et un diagnostic en cas d’échec. Les assertions attendent les réponses du serveur plutôt que de supposer un rendu synchrone.

Le parcours du nouveau compte vérifie inscription, vérification de l’adresse, création d’espace, entreprise, contact, responsable, note, relance, report, clôture, invitation, déconnexion et reconnexion après réinitialisation du mot de passe. L’invitation utilise un transport de test, pas une livraison externe.

### Pagination et statistiques

- Contacts et entreprises : recherche serveur, filtres de responsable/secteur/suivi/archives, tris et pagination, coordonnées associées limitées à la page.
- Notes : pages de dix par fiche, indépendantes du formulaire de nouvelle note.
- Interlocuteurs d’une entreprise : pages de dix et coordonnées chargées à la demande.
- Relances : pages de vingt-cinq, filtres de statut, responsable et période ; accès aux relances terminées et annulées conservé.
- Historique : endpoint paginé existant conservé.
- Fiches : contexte propre et trois prochaines relances, sans parcourir toutes les fiches en mémoire.
- Dashboard : agrégats PostgreSQL sur l’ensemble des données, douze mois d’évolution, origines regroupées et six premiers secteurs ; dix relances au plus par période. Les totaux ne sont pas limités à l’échantillon affiché.
- Sélecteurs : recherche serveur et cinquante suggestions, avec maintien de la valeur choisie. Les suggestions de secteurs sont bornées mais le champ accepte la saisie exacte d’un secteur absent des suggestions.
- Cache navigateur borné : 300 éléments par collection, 3 000 adresses e-mail. Les écrans demandent les données manquantes au serveur.
- `/state` reste un aperçu de compatibilité de cinquante lignes par collection, avec totaux. L’interface active ne l’appelle plus. Un ancien client utilisant ce point d’entrée comme export complet doit migrer vers les collections paginées.

L’export CSV utilise un curseur PostgreSQL par lots de 200 lignes et couvre l’ensemble des résultats. Il propose tous les contacts actifs ou les filtres du répertoire des contacts. Il conserve les coordonnées, ajoute fonction/origine/responsable/archivage et neutralise les formules de tableur.

### Actualisation et concurrence

Actualisation au retour sur l’onglet, au retour du focus, avec le bouton Actualiser et après les mutations. Une saisie en cours diffère le rafraîchissement de la vue. Les requêtes d’un ancien espace, d’une ancienne page ou d’une ancienne recherche ne remplacent pas les résultats actuels. Le cache est vidé au changement d’organisation et à la déconnexion. Il ne s’agit pas d’un service de synchronisation temps réel.

### Départ d’un collaborateur

La désactivation exige un destinataire actif de la même organisation dès qu’il reste des responsabilités. Le transfert couvre contacts, entreprises et relances ouvertes. Les relances terminées ou annulées gardent leur responsable historique.

Le transfert, les événements d’historique, la désactivation et la révocation des sessions de cet espace sont transactionnels. Les écritures d’attribution et la désactivation utilisent le même verrou d’organisation. Les événements sont insérés par requêtes SQL groupées, sans charger toutes les fiches transférées dans Node.js. Le dernier administrateur reste protégé.

### Interface

Les blocs et liens Gmail non fonctionnels sont masqués dans les vues métier. La préparation des brouillons locaux est conservée avec sa mention explicite d’absence d’envoi. Le dashboard privilégie les échéances du jour, en retard et à venir. Les composants et le design général sont conservés ; seules les largeurs des colonnes ont été ajustées après retrait de la colonne Gmail.

## Fichiers concernés

| Fichier | Rôle |
| --- | --- |
| `lib/collections.js` | Requêtes paginées, contextes de fiche, dashboard et export CSV |
| `lib/api.js` | Raccordement des collections, aperçu `/state`, transfert transactionnel |
| `db/migrations/006_collection_indexes.sql` | Index pour les fiches, responsables, notes et relances |
| `public/live.js` | Chargement à la demande, pagination, recherche, rafraîchissement, formulaires et espaces Gmail |
| `public/styles.css` | Largeurs des colonnes du répertoire |
| `tests/api/phase2.test.js` | Volume, pagination, filtres, contextes, CSV, isolation et transfert |
| `tests/live-browser.cjs` | Cible Chrome, diagnostics et recette complète élargie |
| `tests/visual-audit.cjs` | Sélection de l’onglet Chrome |
| `tests/homepage-browser.cjs` | Sélection de l’onglet Chrome |
| `README.md`, `docs/api-phase2.md` | Utilisation et contrats API actualisés |

## Vérifications exécutées

| Commande | Résultat |
| --- | --- |
| `npm test` | 20 tests réussis, zéro échec |
| `npm run test:ui` | Recette complète réussie, aucune exception JavaScript signalée |
| `VISUAL_VIEWS=dashboard,contacts,entreprises,fiche-entreprise,fiche-contact,relances,parametres npm run test:visual` | 56 configurations réussies : 7 vues × 4 largeurs (390/768/1440/1920) × 2 zooms (100/200 %) ; aucun échec détecté par axe, contraste calculé, seuil typographique ou débordement |
| `npm run test:homepage` | Vitrine, liens, menus, FAQ, CTA et 8 configurations responsive/zoom réussis |
| `npm run audit:css` | 544 règles analysées, aucune déclaration de texte sous le seuil |
| `git diff --check` et contrôles syntaxiques Node | Réussis |
| `npm run db:migrate` | Migration 006 appliquée à la base locale de développement |

Les nouveaux tests API créent notamment 5 105 entreprises, contacts, notes et relances dans une organisation isolée. Ils vérifient les pages au-delà du seuil précédent, les totaux, les recherches par e-mail, les filtres combinés, les tris, les paramètres invalides, les contextes privés et l’export complet/filtré. Des notes et interlocuteurs multiples sur une même fiche vérifient leur pagination propre. Le transfert vérifie refus sans destinataire, refus inter-organisation, refus pour un collaborateur, atomicité, conservation des actions passées, historique et révocation des sessions.

La recette navigateur crée aussi 5 005 contacts dans un second espace et atteint la page 501. Elle vérifie l’absence d’appels à `/state`, les changements d’organisation pendant une requête en cours, les réponses de recherche dans le désordre, les ajouts d’un autre utilisateur, la préservation d’une saisie et le transfert depuis le formulaire de gestion des membres.

Les données des recettes utilisent des bases temporaires supprimées à leur terme. Les captures et rapports sont dans `test-results/` (ignoré par Git). Les tests de volume constituent une vérification fonctionnelle ; ils ne remplacent pas une campagne de charge concurrente de production.

## Environnement local et suites

La migration ne modifie pas les lignes métier existantes : elle ajoute huit index. Le serveur local sur le port 3000 a été identifié en comparant son service et le contenu de `live.js` au projet, puis redémarré avec le nouveau backend. Aucun hébergement ni fournisseur externe n’a été créé.

Aucun blocage du Lot 1 n’est observé dans les scénarios exécutés. Les limites suivantes restent explicites :

- Français et heure de Tunis conservés : langue et fuseau par utilisateur relèvent du Lot 2.
- Recherche par sous-chaîne et pagination par offset : mesurer et optimiser pour les très gros volumes et accès concurrents au Lot 5 ; aucun engagement de performance de production.
- Les listes de membres et d’invitations conservent leur fonctionnement actuel, adapté aux petites équipes ; leur pagination devra être prévue si le produit vise de très grandes organisations.
- SMTP réel, sauvegardes chiffrées/restauration, supervision, conformité, administration centrale et abonnements ne sont pas validés par ce lot.
- L’e-mail est simulé dans les recettes. La livraison, les rebonds et les incidents SMTP réels restent à tester dans les lots suivants.
- La suite visuelle métier a été exécutée sur les sept vues concernées ; les autres vues d’authentification ont été contrôlées par la recette navigateur responsive, sans nouvelle exécution de toute la matrice visuelle historique.

Prochaine étape recommandée : Lot 2, avec traductions centralisées français/anglais et préférences de langue/fuseau, avant d’élargir les fonctionnalités commerciales.
