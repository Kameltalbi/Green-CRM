# Ciblix — proposition de conception

## Périmètre soumis à validation

Deux interfaces uniquement : accueil public (`/`) et tableau de bord (`/dashboard`). Identité vert foncé, vert doux, blanc et gris anthracite. Interface française, responsive. Contacts et entreprises fictifs de Tunisie, date de scénario au 28 octobre 2026. Aucun indicateur financier, aucune offre tarifaire inventée. Les futurs tarifs seront en TND.

Le dashboard met en avant les contacts suivis, les relances du jour, les réponses Gmail et l’activité des collaborateurs. Les filtres, la clôture d’une relance et la consultation de conversations fonctionnent en mémoire. Un rechargement réinitialise les données. Les pages complémentaires ont ensuite été autorisées par l’utilisateur ; leur périmètre est décrit en fin de document.

Aucune connexion Gmail, authentification, invitation ou isolation réelle entre entreprises n’est implémentée. L’ancienne API et le fichier de données restent inchangés ; ces vues ne les appellent pas. Le serveur conserve son ancien fonctionnement en attendant la phase back-end et ne doit pas être considéré comme prêt pour une mise en production SaaS.

## Plan de navigation à confirmer avec le cahier des charges

Le cahier des charges mentionné n’est pas disponible dans le dépôt. Hypothèse de six pages à valider : accueil public, tableau de bord, entreprises, contacts, relances, e-mails. Les paramètres de l’espace seront cadrés avec les exigences complètes. La homepage et le dashboard ont été validés par l’utilisateur le 28 octobre 2026. Les quatre pages complémentaires sont désormais réalisées sous forme de démonstration interactive, selon cette hypothèse ; le cahier des charges complet reste à fournir.

## Architecture cible — non implémentée

- Une entreprise cliente correspond à un espace privé (tenant). Les entreprises suivies dans le CRM sont des fiches distinctes du tenant.
- Utilisateurs et adhésions relient les collaborateurs à leurs espaces et rôles : administrateur, collaborateur. Un utilisateur peut appartenir à plusieurs espaces.
- Chaque contact, entreprise suivie, note, relance et conversation porte un identifiant d’espace. Toute opération est autorisée côté serveur à partir de l’identité et de l’adhésion authentifiées, jamais à partir d’un identifiant client seul.
- Prévoir des contrôles d’isolation systématiques, index et contraintes tenant, permissions sur invitations et exportations, et tests d’accès entre deux entreprises avant activation SaaS.
- Connexion Gmail par autorisation OAuth individuelle, secrets stockés côté serveur, périmètres minimaux, tâches de synchronisation liées à l’utilisateur et à l’espace. Les collaborateurs accèdent uniquement aux échanges explicitement partagés.
- Application web et application Android installable consommeront la même API versionnée. Prévoir un client Android dédié ou une enveloppe mobile avec session sécurisée ; les choix de distribution, notifications et mode hors connexion seront cadrés ensuite. La présente interface responsive n’est pas encore une application Android installable.
- La phase d’implémentation précisera contrats API, stockage, migrations, authentification et stratégie Android après validation de la conception. Aucune migration ni API payante n’a été ajoutée.

## Revue visuelle

Démarrer avec `npm start`, puis consulter `http://localhost:3000/` et `http://localhost:3000/dashboard`. Vérifier également les vues mobiles. Les polices DM Sans et Manrope utilisent Google Fonts (service gratuit), avec repli sur les polices sans empattement du système si indisponibles.

## Pages complémentaires — démonstration interactive

- `/entreprises` : cartes, recherche par nom/secteur/ville, filtre du suivi personnel, ajout et fiches détaillées avec notes partagées et contacts associés.
- `/contacts` : cartes, recherche, filtre, ajout, coordonnées et notes avec prochaines actions.
- `/relances` : agenda par date, recherche, attribution, planification et clôture, vue des relances terminées.
- `/emails` : conversations fictives, recherche, filtre non lus, lecture, marquage lu/non lu, brouillons locaux et planification d’une relance depuis un échange.

La navigation interne conserve les ajouts en mémoire entre les pages et prend en charge précédent/suivant du navigateur. Tout rechargement réinitialise l’aperçu. Aucun stockage, appel à l’ancienne API ou envoi Gmail. Les domaines `.example` et numéros de téléphone sont fictifs. Les fiches visibles constituent un échantillon des totaux illustratifs de la maquette du dashboard.

## Alignement avec le cahier des charges fourni

Le fichier `/Users/kameltalbi/Desktop/CAHIER_DES_CHARGES_MINI_CRM_CODEX.md` a désormais été lu. Après accord utilisateur, les écrans Connexion, répertoire Entreprises & Contacts et fiche entreprise ont été réalisés. Les six routes canoniques sont décrites dans le README, qui remplace le plan de navigation provisoire ci-dessus. Les échanges Gmail sont désormais présentés dans les fiches et dans des fenêtres depuis le dashboard, sans page autonome.

La connexion et les droits restent des simulations visibles ; aucun critère de sécurité back-end n’est présenté comme satisfait. Les accès multi-entreprises, l’authentification et Gmail réel restent hors de cette intervention. Les limites restantes d’alignement de la homepage et des relances sont documentées dans le README.

## Phase 2 — remplacement de la démonstration

La description historique ci-dessus correspond aux maquettes précédentes. Désormais `public/live.js`, `lib/`, `db/migrations/` et le README sont les références d’implémentation : PostgreSQL réel, API versionnée, RLS, Google OIDC préparé, invitations et rôles. Les anciennes pages en mémoire ne sont plus chargées. Le dashboard utilise la dernière image et ses couleurs (accents bleu/orange/rouge désormais demandés explicitement). Gmail et Android restent exclus.
