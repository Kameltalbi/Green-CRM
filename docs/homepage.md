# Homepage publique Ciblix — refonte

## Périmètre

Refonte de la homepage uniquement. Aucun changement dans `server.js`, `lib/`, `db/` ou les fonctionnalités métier. Les routes d’inscription et de connexion sont conservées. Les données privées ne sont pas utilisées par la vitrine.

La demande finale « supprime tarifs » prime sur la liste initiale : aucune rubrique, section, comparaison d’offres ni montant n’est affiché. Le CTA « Essayer gratuitement » demandé mène au formulaire d’inscription existant, sans inventer une durée d’essai, une offre ou une promesse commerciale chiffrée.

## Structure

1. Hero : proposition de valeur, création de compte et aperçu réel desktop/mobile.
2. Trois bénéfices : contexte, information partagée, prochaine action.
3. Vue générale du produit et répertoire.
4. Contacts et entreprises, avec fiche contact réelle.
5. Gmail explicitement « À venir », à côté de l’historique actuel des actions.
6. Relances, actions et échéances : opérations effectivement développées.
7. Collaboration et espaces privés, avec gestion des membres.
8. Cas d’usage industrie, services, conseil et associations.
9. Web mobile disponible et Android installable « À venir ».
10. FAQ native à huit accordéons.
11. CTA final.

Header sticky : Fonctionnalités et Solutions en menus déroulants, Intégrations, FAQ, connexion et inscription. Menu mobile fonctionnel, fermeture au clic et à Échap. Footer à quatre colonnes : Produit, Ressources, Entreprise, Informations légales.

## Contenus manquants

Aucune adresse publique ni document juridique validé n’a été fourni. Les entrées Contact, Conditions générales, Confidentialité et Mentions légales sont donc explicitement marquées « À publier ». Elles ouvrent une fenêtre accessible indiquant l’état de publication, sans inventer un document applicable ou une identité légale. Elles possèdent des liens profonds par ancre. Les coordonnées et documents officiels restent à fournir pour compléter la publication.

Aucun témoignage, volume client, chiffre commercial ou tarif inventé. Les captures montrent le vrai produit avec les seules données de test et portent une légende claire. Les tâches sont décrites comme actions de suivi/relance existantes, pas comme un module autonome non développé. Les brouillons sont locaux ; ni envoi ni synchronisation Gmail ne sont annoncés comme disponibles.

## Fichiers

- `public/homepage.js` : génération du contenu et interactions publiques.
- `public/homepage.css` : mise en page publique, scellée par ses classes, sur le design system commun.
- `public/index.html` : document pré-rendu et métadonnées SEO, généré par `npm run build`.
- `public/app.js`, `public/live.js` : branche homepage déléguée au nouveau composant ; reste du CRM conservé.
- `public/assets/product/` : vraies captures du produit, sans données client réelles.
- `scripts/build-homepage.cjs` : pré-rendu statique sans backend ni API externe.
- `scripts/capture-mobile.cjs` : capture du répertoire réel après défilement, sur une base temporaire.
- `tests/api/homepage.test.js`, `tests/homepage-browser.cjs` : contenu, SEO, liens, interactions, responsive et contrastes.

Les captures illustratives proviennent de Chromium sur la version réelle de Ciblix. Les copies desktop sont issues des captures de la refonte de lisibilité, à 1440 × 1080 ; la vue mobile est prise à 390 × 1080, après défilement jusqu’au répertoire. Elles sont agrandissables. Aucun écran fictif Gmail ni application Android native n’est dessiné.

## Performances et SEO

Le contenu public et son unique h1 sont présents dans le HTML avant JavaScript. Les scripts sont différés, la police Inter est locale/préchargée, le hero dispose d’une image prioritaire et les autres captures utilisent le chargement différé avec dimensions réservées. Le contenu pré-rendu est conservé lors de l’initialisation, ce qui évite de remplacer inutilement le DOM de la homepage.

Titre, description et métadonnées Open Graph sont fournis. Aucun domaine canonique, réseau social ou coordonnée d’éditeur n’est inventé. Pas de nouvelle bibliothèque d’interface, de tracker, d’animation ni de service payant.

## Validation

- `npm run build` et contrôles de syntaxe JavaScript : réussis.
- `npm test` : 18 tests réussis, incluant le contrat de design et la homepage.
- `npm run test:homepage` : tous les liens et CTA vérifiés, menus et FAQ testés, header sticky contrôlé, états juridiques accessibles.
- 390, 768, 1440 et 1920 px à 100 % et 200 % : aucun débordement, aucune violation axe-core AA détectée, aucun contraste de texte calculé inférieur à 4,5:1 ; minimum mesuré 6,64:1.
- Captures réelles : `test-results/homepage/1440.png`, `390.png`, `complete-1440.png` ; rapport `audit.json`.

La mesure à 200 % utilise le reflow Chromium (viewport CSS divisé par deux et facteur de rendu doublé). Les résultats sont ceux des contrôles effectués et ne constituent pas une certification indépendante WCAG.
