# Refonte ciblée des pages d’authentification

29 octobre 2026. Références : les captures de connexion et d’inscription fournies par l’utilisateur.

## Interface livrée

- Une colonne, logo Ciblix au-dessus d’une carte de 448 px maximum, centrage dans l’espace disponible.
- Fond neutre clair, carte blanche, titre court, champs de 48 px, bouton vert principal et lien secondaire séparé par une bordure discrète.
- Connexion : e-mail, mot de passe avec afficher/masquer, récupération, bouton Se connecter et création de compte. Aucun argumentaire, onglet de mode, encart Gmail ou teaser Google indisponible.
- Inscription : nom complet, e-mail professionnel, mot de passe et confirmation. Le nom de l’entreprise se renseigne après vérification, dans le parcours `/bienvenue` déjà existant. Les anciens comptes préremplis gardent leur création automatique d’espace.
- Même carte et hiérarchie pour récupération, réinitialisation, vérification, invitations et création d’espace.
- Français et anglais via dictionnaires centralisés et préférence de langue mémorisée. Les valeurs saisies restent en mémoire pendant le changement de langue, sans stockage des mots de passe. Le reste du CRM reste en français.
- Pied de page : copyright et langue ; aucun lien juridique fictif. `CiblixI18n.legalLinks` permet de déclarer uniquement les documents effectivement publiés.
- La boîte e-mail locale reste accessible dans un détail replié sur les étapes qui en ont besoin ; elle n’encombre ni connexion ni inscription.

## Authentification conservée

Aucune modification du backend, de la base de données ou des mécanismes Better Auth pour cette refonte. Routes d’identité, sessions, cookies, CSRF, vérification obligatoire, limites de mot de passe et réinitialisation sont conservés.

La confirmation du mot de passe est vérifiée avant l’appel d’inscription. La connexion conserve la persistance de session activée par défaut dans le parcours précédent. Google reste disponible dans le code si le serveur annonce le fournisseur configuré ; en l’absence de configuration, aucun bouton ni texte Google n’est affiché. Le formulaire principal ne dépend pas du temps de réponse de cette configuration facultative.

La langue est centralisée dans `public/i18n.js`, via `CiblixI18n.t`, `setLanguage` et la préférence `ciblix.language`. Un paramètre `?lang=fr|en` peut également définir la langue. Les pages ne stockent aucune donnée d’authentification dans le navigateur. Le changement de langue est désactivé pendant la soumission, pour préserver la requête en cours.

## Fichiers concernés par cette refonte

| Fichier | Modification |
| --- | --- |
| `public/auth-ui.js` | Présentation, textes traduits, confirmation et gestion des messages accessibles |
| `public/i18n.js` | Dictionnaires FR/EN et préférence de langue partagée |
| `public/styles.css` | Styles des pages d’authentification, règles responsive ciblées |
| `public/live.js` | Rétablissement de la langue française du document hors pages traduites |
| `scripts/build-homepage.cjs`, `public/index.html` | Chargement du module de langue avant l’interface d’authentification |
| `tests/api/i18n.test.js` | Cohérence des dictionnaires, paramètres et comportement du stockage |
| `tests/live-browser.cjs` | Nouveau parcours d’inscription, matrice FR/EN, clavier et invitations |
| `README.md` | Parcours et portée des traductions actualisés |

Les changements précédents du Lot 1 sont conservés dans l’espace de travail ; ils ne constituent pas une nouvelle refonte du dashboard.

## Vérifications

- `npm test` : **22 tests réussis**, dont les tests des sessions, de l’isolation et des parcours Better Auth. Les deux tests de traduction ont aussi été réexécutés après les derniers ajustements de libellés.
- `npm run test:ui` : parcours complet de création de compte, vérification d’adresse, création d’espace, connexion, récupération, réinitialisation, déconnexion et invitation avec inscription puis acceptation explicite. Les opérations CRM du Lot 1 restent couvertes dans cette même recette.
- Matrice supplémentaire : **36 configurations**, soit six pages × deux langues × trois largeurs **390, 768 et 1440 px**. Vérification du logo, du centrage horizontal, de la largeur maximale, de la langue, de l’absence de Google indisponible, des débordements et des règles WCAG AA via axe-core.
- Connexion sans défilement vertical à **1440 × 768** et **1440 × 900**. Sur les écrans courts ou avec zoom élevé, la page peut défiler naturellement sans masquer le formulaire.
- Clavier réel via Chrome : ordre des tabulations, liens par Entrée, afficher/masquer par Espace, validation native et soumission de connexion par Entrée. Erreur de connexion en anglais, confirmation incorrecte refusée avant création de compte, changement de langue sans perte de saisie et préférence conservée après rechargement.
- Configuration facultative retardée : formulaire de connexion disponible pendant l’attente, saisie conservée à la réception de la réponse.
- `VISUAL_VIEWS=connexion,inscription,verification,mot-de-passe,reinitialisation npm run test:visual` : **40 configurations** (5 pages × 4 largeurs × 2 zooms), aucun échec détecté de contraste, accessibilité, taille de texte ou débordement.
- `npm run audit:css` et `git diff --check` : contrôles des règles CSS et des différences.

Captures FR/EN et résultats : `test-results/auth/`. Rapport de la matrice au zoom : `test-results/after/audit.json`. Les données de recette utilisent une base PostgreSQL temporaire supprimée à la fin des tests.

Aucun test utilisateur chronométré n’a mesuré le seuil perceptif de deux secondes ; le formulaire est le seul contenu principal et apparaît sans attendre la configuration facultative. La livraison réelle des e-mails et Google OAuth réel restent hors de cette recette locale.
