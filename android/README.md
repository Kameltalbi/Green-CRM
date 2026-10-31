# Ciblix Android

Premier client Android natif Java, sans WebView ni dépendance UI externe, utilisant le serveur Ciblix existant. Android 8.0 minimum (API 26).

## Fonctionnalités

- Connexion e-mail/mot de passe avec un compte vérifié et création initiale d’espace.
- Session Bearer signée Better Auth, conservée chiffrée AES-GCM avec clé Android Keystore ; aucun mot de passe enregistré. Sauvegarde Android désactivée.
- Tableau de bord et relances en retard, du jour et à venir.
- Contacts et entreprises : recherche serveur, pagination par 25, consultation, création et modification des champs principaux.
- Scanner un document (photo ou PDF, jusqu’à 5 pages) : analyse via le backend Ciblix (Gemini), vérification puis création/complétion de fiches. Seul le nom est obligatoire. Aucune clé Gemini dans l’APK.
- Ajout de notes partagées depuis une fiche.
- Création de relances générales ou rattachées à une fiche, modification et clôture.
- Changement d’organisation et déconnexion avec révocation serveur.

## Compiler

Ouvrir ce dossier dans Android Studio avec un JDK 17 ou 21 et le SDK Android 35. Le projet utilise Gradle 8.11.1 et Android Gradle Plugin 8.7.2.

```sh
./gradlew assembleDebug lintDebug
```

Le premier lancement de Gradle peut télécharger ses dépendances. L’APK de développement est produit dans `app/build/outputs/apk/debug/app-debug.apk`. La version de publication doit être signée avec votre propre clé ; aucune publication Play Store n’est effectuée.

## Connecter le serveur local

Démarrer PostgreSQL, effectuer les migrations et lancer le serveur depuis la racine du dépôt, selon le README principal. L’application n’embarque ni base métier ni serveur.

- Émulateur Android : adresse préremplie `http://10.0.2.2:3000`.
- Téléphone USB : lancer `adb reverse tcp:3000 tcp:3000`, puis saisir `http://127.0.0.1:3000` dans l’application de développement.
- Serveur déployé : saisir son origine HTTPS, sans chemin, par exemple `https://crm.exemple.tn`.

Seule la variante debug autorise HTTP sur les trois hôtes de développement explicites. La variante release exige HTTPS. Le serveur local conserve son propre `APP_URL` pour les liens de vérification et réinitialisation : ouvrir ces liens depuis un navigateur capable de joindre cette adresse (par exemple sur le Mac pendant le développement).

Utiliser les vrais comptes du serveur. L’adresse doit être vérifiée par e-mail ; aucun accès fictif n’est ajouté. La création de compte et le mot de passe oublié passent par la page de connexion web ouverte dans le navigateur. Google natif et les liens profonds ne sont pas implémentés.

## Périmètre

Données chargées à l’ouverture d’un écran ou via Actualiser, sans mode hors ligne. Les brouillons de formulaires ne sont pas conservés après rotation/fermeture. Les fiches modifient nom/fonction/téléphone/origine ou nom/secteur/ville/description. L’édition des adresses e-mail, de l’entreprise d’un contact, des responsables, les historiques et la lecture des notes, les cartes de visite, les invitations, l’archivage et la suppression restent dans le client web. Les relances acceptent actuellement une échéance ISO 8601 avec fuseau explicitement saisi. Aucun rappel système ni synchronisation Gmail.

L’APK de production utilise par défaut `https://ciblix.com`. L’importation de documents exige que la fonctionnalité soit déployée et configurée sur ce serveur (`DOCUMENT_AI_API_KEY`). Sans déploiement serveur, l’analyse renverra une erreur de configuration.

## Vérification manuelle

Avec le serveur actif et un compte vérifié : connexion, création d’espace si nécessaire, compte/organisation, chargement du tableau de bord, recherche sans résultat et pagination, création et modification de contact/entreprise, note depuis une fiche, relance depuis une fiche puis clôture. Vérifier également le message d’erreur hors réseau et une reconnexion après révocation de session. Les règles d’accès et d’isolation restent vérifiées par l’API sur chaque requête.

## Validation dans cet environnement

La compilation Java avec le SDK 35 et `assembleDebug` ont réussi. En raison d’un DNS indisponible, le build a utilisé un dépôt temporaire reconstruit depuis le cache local, avec Kotlin 2.0.21 pour les outils Gradle (l’application est en Java). Le wrapper standard est fourni pour les prochains builds disposant du réseau.

`lintDebug` n’a pas pu s’exécuter : `com.android.tools.lint:lint-gradle:31.7.2` manque localement. L’installation sur l’émulateur API 35 a été tentée, mais Android l’a refusée faute d’espace disponible sur `/data`. Le lancement et les parcours authentifiés sur appareil restent donc à valider ; aucune donnée de l’émulateur existant n’a été supprimée.
