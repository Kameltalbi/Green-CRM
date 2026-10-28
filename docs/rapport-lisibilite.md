# Refonte globale de la lisibilité — 28 octobre 2026

## Audit initial

Le projet ne contient ni Tailwind ni configuration de thème externe : une seule feuille `public/styles.css` pilotait les pages. Elle accumulait 1 577 règles, souvent répétées et plus spécifiques dans les variantes mobiles. L’analyse PostCSS a identifié **584 déclarations de taille inférieure à 14 px**, jusqu’à 6 px, ainsi que de nombreuses couleurs locales trop pâles.

Les principaux groupes responsables étaient les formulaires `auth-*`, les colonnes `directory-table`, les badges `tag`/`tracking-badge`, les textes `board-*`, les métadonnées de fiches, la sidebar et l’aperçu produit de la homepage. Les polices DM Sans/Manrope et les couleurs déclarées directement sur ces composants écrasaient les règles de base.

Sur 26 captures de référence (13 vues, 390/1440 px), le contrôle du rendu a relevé 1 449 observations de textes sous 14 px et 562 observations de contraste insuffisant. Ces nombres cumulent plusieurs vues et formats : ils ne représentent pas des éléments uniques.

## Correction appliquée

La feuille est réécrite en 545 règles lisibles, organisées autour d’un seul système de composants. Les anciennes exceptions locales ne sont pas conservées derrière de nouvelles surcharges. Inter et sa licence sont hébergées dans `public/fonts/` ; aucun téléchargement de police externe n’est nécessaire au chargement.

| Rôle | Règle commune |
| --- | --- |
| Texte principal | 16 px, `#1F2937` |
| Texte secondaire, labels, métadonnées | 14–16 px, `#475569` |
| Champs, boutons, liens d’action | 16 px |
| Titres de section | 22–28 px |
| Titres principaux | 36–40 px |
| Interligne | 1,4 pour les titres, 1,5 pour les textes |
| Vert principal | `#14532D` |
| Fond / cartes / bordures | `#F8FAF9` / `#FFFFFF` / `#CBD5D1` |

Les composants partagés couvrent boutons, champs, labels, onglets, tableaux, badges, cartes, menus, modales, formulaires et navigation. Les textes ne deviennent plus petits dans les media queries. Les marges des sections sont ramenées à une échelle de 16–40 px, les anciens grands espaces décoratifs sont retirés, et les blocs s’adaptent au contenu plutôt que de couper les textes.

Les libellés des graphiques sont rendus en HTML, séparément des barres/SVG, pour qu’une réduction du graphique ne réduise pas aussi le texte. Les données, calculs et sélecteurs restent inchangés. Un débordement causé par le champ masqué de carte de visite a été corrigé à sa source.

Aucune nouvelle fonctionnalité métier ou d’authentification n’a été ajoutée pendant cette refonte.

## Vérifications

**104 combinaisons testées** : 13 vues × 4 largeurs × 2 niveaux de zoom.

Vues : homepage, connexion, inscription, vérification d’e-mail, mot de passe oublié, réinitialisation, dashboard, Entreprises, Contacts, fiche entreprise, panneau contact, relances et paramètres/membres.

Largeurs physiques : **390, 768, 1440, 1920 px**. Rendu 100 % et 200 %. Le zoom est reproduit dans Chromium par une largeur/hauteur CSS divisée par le facteur de zoom et un facteur de rendu augmenté : cela exerce à la fois le reflow et l’agrandissement physique des textes, au lieu de simplement étirer une capture. Les captures sont prises à 100 % et 200 % pour 390 et 1440 px ; les quatre largeurs sont mesurées.

Résultats finaux :

- Aucun texte visible sous 14 px, ni déclaration CSS de taille sous 14 px.
- Aucun débordement horizontal du document.
- Aucune violation détectée par axe-core pour les règles WCAG 2 A/AA et 2.1 AA exécutées.
- Contrôle complémentaire des couleurs de texte rendues, avec composition des fonds transparents et contrôle du fond de grille des graphiques : aucun rapport inférieur à 4,5:1 ; **minimum observé 5,04:1**.
- Axe laisse 42 occurrences de contraste à vérifier par une autre méthode ; le calcul complémentaire et la revue des captures couvrent ces superpositions. Le résultat est celui de ces contrôles, pas une certification indépendante de l’ensemble des critères WCAG.
- `npm test` : **17 tests réussis** (serveur, PostgreSQL, isolation et contrats visuels).
- `npm run test:ui` : parcours métiers et authentification réussis, sans erreur JavaScript. Inscription, vérification, création d’espace, réinitialisation et reconnexion restent opérationnelles.

Les tests emploient des bases et identités temporaires. Aucune donnée client réelle n’est utilisée dans les captures, ni modifiée par les contrôles.

## Captures et reproduction

Les captures réelles et rapports sont dans `test-results/before/` et `test-results/after/`. Le comparatif local `test-results/comparatif-lisibilite.html` place les vues avant/après côte à côte ; un clic sur chaque capture permet de l’ouvrir à sa taille originale.

Ces fichiers générés sont volontairement ignorés par Git. Le rapport versionné et les scripts permettent de reproduire les mesures :

- `npm run audit:css`
- `npm test`
- `CHROME_BIN=/chemin/vers/chromium npm run test:ui`
- `CHROME_BIN=/chemin/vers/chromium npm run test:visual`

Les critères de contraste et de redimensionnement utilisés sont ceux du [W3C — contraste minimum](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) et du [W3C — redimensionnement du texte](https://www.w3.org/WAI/WCAG21/Understanding/resize-text).

La validation visuelle de l’utilisateur est attendue avant tout nouveau développement fonctionnel.
