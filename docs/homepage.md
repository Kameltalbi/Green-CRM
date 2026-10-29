# Homepage publique Ciblix — refonte

## Périmètre

Refonte de la homepage uniquement. Aucun changement dans `server.js`, `lib/`, `db/` ou les fonctionnalités métier. Les routes d’inscription et de connexion sont conservées. Les données privées ne sont pas utilisées par la vitrine.

La demande finale « supprime tarifs » prime sur la liste initiale : aucune rubrique, section, comparaison d’offres ni montant n’est affiché. Le CTA « Essayer gratuitement » demandé mène au formulaire d’inscription existant, sans inventer une durée d’essai, une offre ou une promesse commerciale chiffrée.

## Structure

1. En-tête : logo, Fonctionnalités, Comment ça marche, Connexion, sélecteur FR/EN, création de compte, menu mobile.
2. Hero : titre, sous-titre, création de compte, lien vers les fonctionnalités, photographie de l’équipe.
3. Trois bénéfices.
4. Trois blocs de fonctionnalités, sans capture du logiciel.
5. Trois étapes.
6. Quatre profils.
7. Trois raisons de choisir Ciblix.
8. FAQ : publics, collaboration et langues réellement disponibles. L’import de contacts n’est pas annoncé.
9. Appel à l’action.
10. Pied de page : logo, description courte et liens existants.

Aucune capture, aucun mockup et aucune page juridique tant que les documents ne sont pas publiés.

## Contenus manquants

Aucune adresse publique ni document juridique validé n’a été fourni. Les entrées Contact, Conditions générales, Confidentialité et Mentions légales sont donc explicitement marquées « À publier ». Elles ouvrent une fenêtre accessible indiquant l’état de publication, sans inventer un document applicable ou une identité légale. Elles possèdent des liens profonds par ancre. Les coordonnées et documents officiels restent à fournir pour compléter la publication.

Aucun témoignage, volume client, chiffre commercial ou tarif inventé. La seule image est la photographie de l’équipe commerciale. Ni envoi ni synchronisation Gmail ne sont annoncés sur cette page.

## Fichiers

- `public/homepage.js` : génération du contenu et interactions publiques.
- `public/homepage.css` : mise en page publique, scellée par ses classes, sur le design system commun.
- `public/index.html` : document pré-rendu et métadonnées SEO, généré par `npm run build`.
- `public/app.js`, `public/live.js` : branche homepage déléguée au nouveau composant ; reste du CRM conservé.
- `public/assets/presentation-tableau-de-bord.jpg` : seule image de la page, photographie de l’équipe.
- `scripts/build-homepage.cjs` : pré-rendu statique sans backend ni API externe.
- `tests/api/homepage.test.js`, `tests/homepage-browser.cjs` : contenu, SEO, liens, langue, responsive et contrastes.

Les captures du produit restent hors de la page d’accueil.

## Performances et SEO

Le contenu public et son unique h1 sont présents dans le HTML avant JavaScript. Les scripts sont différés, la police Inter est locale/préchargée et la photographie du hero est prioritaire. Le HTML pré-rendu en français est conservé si la langue active est le français.

Titre, description et métadonnées Open Graph sont fournis. Aucun domaine canonique, réseau social ou coordonnée d’éditeur n’est inventé. Pas de nouvelle bibliothèque d’interface, de tracker, d’animation ni de service payant.

## Validation

- `npm run build`, le test de contenu et le contrat de design : réussis.
- `npm run test:homepage` : liens réels, français et anglais, CTA d’inscription et de connexion, header sticky.
- 390, 768, 1440 et 1920 px à 100 % et 200 % : aucun débordement, aucune violation axe-core AA détectée.
- Captures : `test-results/homepage/390.png`, `768.png`, `1440.png`, `1920.png` ; rapport `audit.json`.

La mesure à 200 % utilise le reflow Chromium (viewport CSS divisé par deux et facteur de rendu doublé). Les résultats sont ceux des contrôles effectués et ne constituent pas une certification indépendante WCAG.
