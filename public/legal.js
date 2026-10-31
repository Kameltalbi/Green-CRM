const legalPages = new Set(['/privacy', '/terms']);

function legalGap(text) {
  return `<div class="legal-gap"><strong>À compléter</strong><p>${text}</p></div>`;
}

function legalFacts(rows) {
  return `<dl class="legal-facts">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function publisherFacts() {
  return legalFacts([
    ['Dénomination', 'DECARBOTECH SARL'],
    ['Forme juridique', 'Société à responsabilité limitée'],
    ['Siège social', '3, rue Erroussafa, La Soukra 2036, Tunisie'],
    ['Identifiant unique', '1953399W'],
    ['Représentant', 'Kamel Talbi'],
    ['Application', 'Ciblix CRM'],
    ['Site', '<a href="https://ciblix.com">https://ciblix.com</a>'],
    ['E-mail', '<a href="mailto:kameltalbi.tn@gmail.com">kameltalbi.tn@gmail.com</a>']
  ]);
}

function renderLegalPage(path) {
  const terms = path === '/terms';
  const title = terms ? 'Conditions générales d’utilisation' : 'Politique de confidentialité';
  document.documentElement.lang = 'fr';
  document.title = `${title} — Ciblix`;
  const links = [['/privacy', 'Confidentialité'], ['/terms', 'Conditions d’utilisation'], ['/connexion', 'Connexion']];
  app.innerHTML = `<div class="legal-page public-page"><a class="home-skip" href="#contenu">Aller au contenu</a><header class="marketing-header"><div class="home-header-inner"><a class="brand" href="/" aria-label="Ciblix, accueil"><img class="brand-wordmark" src="/assets/logo-ciblix.png" alt=""></a><nav class="legal-header-nav" aria-label="Pages publiques">${links.map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav></div></header><main id="contenu" class="legal-main">${terms ? termsDocument() : privacyDocument()}</main>${publicFooterMarkup(key => CiblixI18n.t(key))}</div>`;
  window.scrollTo(0, 0);
}

function privacyDocument() {
  return `<p class="legal-kicker">Ciblix</p><h1>Politique de confidentialité</h1><p class="legal-updated">Version du 30 octobre 2026. Cette page décrit le fonctionnement actuel de l’application. Les encadrés « À compléter » signalent un point qui n’est pas fixé dans le produit et qui reste à valider.</p>
  <nav class="legal-toc" aria-label="Sommaire"><ol>
    <li><a href="#editeur">Éditeur</a></li>
    <li><a href="#perimetre">Champ d’application</a></li>
    <li><a href="#donnees">Données traitées</a></li>
    <li><a href="#finalites">Finalités</a></li>
    <li><a href="#bases">Bases légales</a></li>
    <li><a href="#durees">Durées de conservation</a></li>
    <li><a href="#destinataires">Destinataires et transferts</a></li>
    <li><a href="#gmail">Connexion Gmail</a></li>
    <li><a href="#documents">Importation de documents</a></li>
    <li><a href="#limited-use">Google API Services User Data Policy</a></li>
    <li><a href="#securite">Mesures de sécurité</a></li>
    <li><a href="#droits">Vos droits</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol></nav>
  <section aria-labelledby="editeur"><h2 id="editeur">Éditeur</h2><p>Ciblix CRM est édité par DECARBOTECH SARL, société établie en Tunisie.</p>${publisherFacts()}</section>
  <section aria-labelledby="perimetre"><h2 id="perimetre">Champ d’application</h2><p>Cette politique concerne le site public, la création de compte, l’espace de travail, la connexion Gmail facultative et l’importation de documents facultative. Elle ne décrit pas les pratiques de Google.</p><p>DECARBOTECH SARL exploite le service. Elle traite les données des comptes nécessaires pour ouvrir l’accès, maintenir la session et faire fonctionner Ciblix CRM.</p><p>Chaque entreprise cliente décide des prospects et clients qu’elle enregistre dans son espace. Elle est responsable de ces fiches, des notes, des relances et des messages qu’elle y place, y compris du fait de disposer d’un droit de les utiliser. Les membres d’une même organisation voient les données partagées de cet espace. DECARBOTECH SARL ne choisit pas le contenu de ces fiches.</p><p>Le cadre tunisien pris en compte est la loi organique n° 2004-63 du 27 juillet 2004 relative à la protection des données à caractère personnel. Cette mention décrit le cadre de référence. Elle ne constate pas qu’une formalité ou une conformité a été vérifiée.</p></section>
  <section aria-labelledby="donnees"><h2 id="donnees">Données traitées</h2><h3>Compte et session</h3>${legalFacts([
    ['Identité du compte', 'Nom, adresse e-mail, nom d’entreprise indiqué à la création de l’espace, état de vérification de l’adresse.'],
    ['Mot de passe', 'Choisi par la personne, de 12 à 128 caractères. Il n’est pas réaffiché. Ciblix ne demande jamais le mot de passe Gmail.'],
    ['Session', 'Identifiant de session, organisation active, jeton anti-falsification, adresse IP et type de navigateur. La session expire au bout de sept jours. Si le service est utilisé, cette échéance est renouvelée au plus une fois par jour.'],
    ['Connexion Google', 'Facultative et distincte de Gmail. Elle demande les autorisations openid, email et profile, uniquement pour identifier le compte. Les jetons de cette connexion sont chiffrés par le composant d’authentification.']
  ])}<h3>Espace de travail</h3>${legalFacts([
    ['Organisation', 'Nom, logo, membres et rôle (administrateur ou membre).'],
    ['Invitations', 'Adresse e-mail invitée, rôle proposé, date d’expiration. Le lien d’invitation est valable sept jours, jusqu’à acceptation ou révocation.'],
    ['Contacts et entreprises', 'Nom, fonction, téléphone, adresses e-mail, source, secteur, ville, description, adresse, site web, responsable, lien entre un contact et une entreprise.'],
    ['Suivi', 'Notes, relances (objet, échéance, responsable, état) et historique des actions.'],
    ['Carte de visite', 'Image JPEG, PNG ou WebP ajoutée sur une fiche contact, dans la limite de 8 Mo.'],
    ['Importation de documents', 'Métadonnées d’analyse (type, taille, nombre de pages, modèle, jetons estimés, statut). Le fichier lui-même n’est pas conservé après l’analyse.']
  ])}<h3>E-mails envoyés par Ciblix</h3><p>Les messages de vérification d’adresse, de réinitialisation de mot de passe et d’invitation partent par SMTP, avec le composant Nodemailer, vers l’hôte indiqué dans la configuration du déploiement. Le lien de vérification est valable une heure. Le lien de réinitialisation est valable 30 minutes. En production, la connexion vers ce serveur exige TLS. Le nom du prestataire et le pays d’envoi ne sont pas écrits dans l’application. En développement local, ces messages peuvent rester sur la machine et ne pas être remis sur Internet.</p></section>
  <section aria-labelledby="finalites"><h2 id="finalites">Finalités</h2><ul>
    <li>Créer le compte, vérifier l’adresse e-mail et permettre la connexion.</li>
    <li>Fournir l’espace de travail : contacts, entreprises, notes, relances et historique.</li>
    <li>Permettre à un administrateur d’inviter ou de retirer un membre.</li>
    <li>Envoyer les messages nécessaires au compte (vérification, mot de passe, invitation).</li>
    <li>Proposer, si l’utilisateur le demande, l’envoi d’un e-mail depuis son propre compte Gmail.</li>
    <li>Proposer, si l’utilisateur le demande et si la fonction est configurée, l’analyse d’un document pour préremplir des fiches.</li>
    <li>Limiter les abus de connexion et maintenir la session de la personne connectée.</li>
  </ul><p>L’application ne contient pas de module publicitaire. Les données ne sont pas utilisées pour de la publicité.</p></section>
  <section aria-labelledby="bases"><h2 id="bases">Bases légales</h2><p>La loi organique n° 2004-63 encadre les traitements de données personnelles. L’application ne qualifie pas elle-même chaque finalité. La connexion Gmail repose, dans le produit, sur l’autorisation explicite que l’utilisateur donne à Google. Cette autorisation n’a pas été qualifiée juridiquement dans cette page.</p>${legalGap('Base retenue pour chaque finalité, et formalités éventuelles auprès de l’Instance nationale de protection des données personnelles. Aucune de ces qualifications n’est enregistrée dans l’application.')}</section>
  <section aria-labelledby="durees"><h2 id="durees">Durées de conservation</h2><p>Certaines durées sont fixées par le produit. Les autres ne le sont pas : aucune suppression automatique des fiches, des comptes ou des messages enregistrés n’est prévue.</p>${legalFacts([
    ['Session', 'Sept jours, renouvelée au plus une fois par jour en cas d’utilisation.'],
    ['Vérification d’adresse', 'Le lien expire au bout d’une heure.'],
    ['Mot de passe oublié', 'Le lien expire au bout de 30 minutes.'],
    ['Invitation', 'Sept jours, ou plus tôt en cas d’acceptation ou de révocation.'],
    ['Autorisation Gmail en cours', 'L’état technique de la connexion expire au bout de dix minutes et est supprimé après usage.'],
    ['Compte, fiches, historique et messages enregistrés', 'Aucune durée automatique.']
  ])}${legalGap('Durée de conservation du compte, des fiches, de l’historique, des messages enregistrés et des journaux techniques du serveur, ainsi que le point de départ de chaque durée.')}</section>
  <section aria-labelledby="destinataires"><h2 id="destinataires">Destinataires et transferts</h2><ul>
    <li>Les membres actifs de la même organisation accèdent aux données commerciales partagées et à l’extrait d’historique décrit dans la section Gmail.</li>
    <li>Si la personne choisit « Continuer avec Google », Google reçoit la demande d’identification. Cette connexion ne permet pas d’envoyer des e-mails.</li>
    <li>Si la personne connecte Gmail, Google reçoit l’autorisation, les jetons, puis le message à envoyer. Le détail est dans la section suivante.</li>
    <li>Si la personne importe un document et confirme l’envoi, Google (API Gemini) reçoit le fichier le temps de l’analyse. Le détail est dans la section « Importation de documents ».</li>
    <li>Le serveur SMTP configuré pour le déploiement reçoit l’adresse et le contenu des messages de compte.</li>
  </ul><p>Les données du service sont enregistrées dans PostgreSQL. Le dépôt de l’application ne nomme ni l’hébergeur, ni le pays où ce serveur est situé. L’application n’y est pas déployée. Les polices du site sont servies par Ciblix, sans appel à un service de polices tiers.</p>${legalGap('Nom de l’hébergeur, pays d’hébergement, nom du serveur SMTP de production, et mécanisme qui encadrerait un transfert hors de Tunisie. Ces éléments ne figurent pas dans l’application.')}</section>
  <section aria-labelledby="gmail"><h2 id="gmail">Connexion Gmail</h2><p>La connexion à Gmail est facultative. Elle est proposée dans les paramètres, section « Comptes e-mail ». Rien n’est envoyé à Gmail tant que l’utilisateur n’a pas lancé cette connexion, coché le consentement de partage organisationnel dans Ciblix, puis accepté l’écran d’autorisation de Google.</p><p>Ciblix utilise OAuth 2.0 de Google, avec un code d’autorisation et une vérification PKCE. L’utilisateur choisit le compte sur l’écran de Google. Ciblix ne demande pas le mot de passe Gmail.</p><p>Les autorisations demandées sont <code>https://www.googleapis.com/auth/gmail.send</code>, <code>https://www.googleapis.com/auth/gmail.readonly</code>, <code>openid</code> et <code>email</code>.</p><ul>
    <li><code>gmail.send</code> permet d’envoyer un message au nom de l’utilisateur, uniquement depuis son propre compte connecté.</li>
    <li><code>gmail.readonly</code> permet de synchroniser les messages associés aux contacts déjà présents dans le CRM. Les messages sans correspondance CRM ne sont pas enregistrés.</li>
    <li><code>openid</code> et <code>email</code> servent à identifier l’adresse du compte choisi.</li>
  </ul><p>Avant l’autorisation Google, Ciblix informe que les échanges commerciaux synchronisés seront visibles par les collaborateurs de la même organisation. Un collaborateur ne peut pas envoyer depuis le Gmail d’un autre sans délégation Google séparée (non proposée dans Ciblix).</p><p>Les jetons d’accès et de rafraîchissement sont conservés chiffrés (AES-256-GCM, clé dérivée par HKDF-SHA256). Ils ne sont pas affichés dans le navigateur. L’utilisateur peut déconnecter un compte depuis les paramètres. La déconnexion supprime le compte, les messages synchronisés de ce compte et demande à Google de révoquer l’autorisation.</p><h3>Ce qui est conservé après un envoi</h3><p>Le message n’est inscrit dans l’historique de la fiche qu’après confirmation par Gmail. Ciblix conserve alors, pour l’organisation :</p><ul>
    <li>le destinataire, l’objet et le texte complet saisi dans Ciblix (20 000 caractères maximum) ;</li>
    <li>l’identifiant du message renvoyé par Gmail ;</li>
    <li>le lien vers la fiche contact et, si elle existe, l’entreprise ;</li>
    <li>le statut d’envoi.</li>
  </ul><h3>Ce qui est conservé après synchronisation</h3><p>Pour chaque message associé à au moins un contact CRM, Ciblix conserve dans l’organisation : direction, adresses, objet, extrait, corps texte limité, date, collaborateur propriétaire du compte Gmail, et les liens vers les contacts. Les messages hors CRM, brouillons, spam et corbeille ne sont pas synchronisés.</p><p>Les pièces jointes d’envoi sont transmises à Gmail (7 Mo au total) et ne sont pas enregistrées dans Ciblix. La synchronisation enregistre seulement un indicateur de présence de pièces jointes, pas leur contenu.</p><h3>Transfert et suppression liés à Gmail</h3><p>Les messages restent dans la boîte Gmail de l’utilisateur : Ciblix ne les supprime pas chez Google. La déconnexion retire les jetons, le compte connecté et les messages synchronisés de ce compte. Les envois déjà confirmés dans <code>gmail_messages</code> et les lignes d’activité associées ne sont pas effacés automatiquement.</p>${legalGap('Délai et modalité pour effacer, sur demande, les messages d’envoi et l’historique d’activité conservés après une déconnexion Gmail. Statut de vérification Google pour le scope restreint gmail.readonly.')}</section>
  <section aria-labelledby="documents"><h2 id="documents">Importation de documents</h2><p>L’importation est facultative. Elle est proposée dans le répertoire (contacts et entreprises). Rien n’est transmis tant que l’utilisateur n’a pas choisi un fichier et coché l’accord d’envoi au prestataire d’analyse.</p><p>Formats acceptés : JPEG, PNG, WebP et PDF, dans la limite de 8 Mo et de cinq pages pour un PDF. Les langues prévues sont le français, l’anglais et l’arabe.</p><p>Lorsque la fonction est configurée, Ciblix envoie le document à l’API Google Gemini (modèle configurable, par défaut <code>gemini-2.5-flash</code>) pour en extraire des propositions d’entreprises et de contacts. La clé d’API reste sur le serveur. Aucune fiche n’est créée ou modifiée tant que l’utilisateur n’a pas vérifié et confirmé la sélection.</p><p>Ciblix conserve, pour le suivi des quotas, des métadonnées d’extraction (organisation, utilisateur, type, taille, pages, modèle, jetons estimés, coût estimé, statut). Le contenu du fichier n’est pas enregistré après l’analyse. Les quotas applicatifs prévus sont vingt documents réussis par organisation et par jour, et un plafond mensuel de coût estimé configurable (dix dollars par défaut pour l’ensemble du déploiement).</p>${legalGap('Qualification juridique de ce transfert vers Google, localisation du traitement Gemini, et durée de conservation côté Google. Ces éléments ne sont pas inscrits dans l’application.')}</section>
  <section aria-labelledby="limited-use"><h2 id="limited-use">Google API Services User Data Policy</h2><p>Les données reçues des API Google pour Gmail comprennent l’adresse du compte, l’identifiant du compte, les jetons, les métadonnées et le contenu texte des messages synchronisés associés aux contacts CRM, ainsi que l’identifiant du message envoyé. Ciblix les utilise pour afficher le compte, envoyer les messages rédigés dans Ciblix, synchroniser l’historique commercial partagé dans l’organisation, renouveler l’autorisation et permettre la déconnexion.</p><p>Ciblix ne revend pas ces données et ne les utilise pas à des fins publicitaires. L’usage reste limité aux fonctions demandées par l’utilisateur dans le CRM. La conformité complète à Limited Use pour un scope restreint comme <code>gmail.readonly</code> dépend aussi des formalités Google (vérification d’application et, le cas échéant, évaluation de sécurité) décrites hors de cette page.</p>${legalGap('Confirmation que la vérification Google / CASA pour gmail.readonly est obtenue, et éventuelle attestation Limited Use mise à jour.')}</section>
  <section aria-labelledby="securite"><h2 id="securite">Mesures de sécurité</h2><p>Les points suivants décrivent des mesures présentes dans l’application. Ils ne constituent ni une certification, ni une garantie contre toute intrusion.</p><ul>
    <li>Les données d’une organisation ne sont pas présentées à une autre organisation.</li>
    <li>Le cookie de session n’est pas lisible par le script de la page. Il est marqué sécurisé lorsque l’adresse du service est en HTTPS.</li>
    <li>Les écritures faites avec ce cookie sont refusées si l’origine de la requête ne correspond pas à l’adresse du service.</li>
    <li>Les jetons Gmail sont chiffrés au repos, séparément des jetons de la connexion Google utilisée pour s’identifier.</li>
    <li>La liste des comptes Gmail et l’historique ne contiennent pas les jetons.</li>
    <li>La connexion et l’API sont soumises à des limites de fréquence.</li>
  </ul>${legalGap('Autres mesures que l’éditeur souhaite annoncer (hébergement, sauvegardes, chiffrement des disques, durée de conservation des journaux). Ne pas les inscrire ici tant qu’elles ne sont pas en place.')}</section>
  <section aria-labelledby="droits"><h2 id="droits">Vos droits</h2><p>Dans le produit, aujourd’hui :</p><ul>
    <li>un utilisateur peut déconnecter lui-même son compte Gmail ;</li>
    <li>les fiches, notes et relances peuvent être modifiées dans l’espace ; une fiche peut aussi être archivée, puis rétablie ;</li>
    <li>un administrateur peut supprimer définitivement une entreprise ou un contact. La suppression d’un contact retire aussi ses adresses e-mail, ses notes et l’image de carte de visite. La suppression d’une entreprise retire ses notes et détache les contacts et les relances, sans les effacer. Les lignes d’historique restent, de même que les messages Gmail déjà enregistrés ;</li>
    <li>un administrateur peut supprimer une note ou une relance ;</li>
    <li>un membre actif peut exporter les contacts de son organisation dans un fichier CSV ;</li>
    <li>un administrateur peut désactiver l’accès d’un membre, ce qui clôt les sessions de ce membre pour cette organisation. Les fiches déjà créées restent ;</li>
    <li>la suppression complète du compte utilisateur n’est pas proposée dans l’interface.</li>
  </ul><p>La loi organique n° 2004-63 prévoit notamment un droit d’accès, un droit de rectification et un droit d’opposition, ainsi qu’une saisine de l’Instance nationale de protection des données personnelles. Cette page ne constate pas que les formalités correspondantes ont été accomplies.</p><p>Une demande peut être envoyée à <a href="mailto:kameltalbi.tn@gmail.com">kameltalbi.tn@gmail.com</a>, ou par courrier au siège de DECARBOTECH SARL.</p>${legalGap('Délai de réponse aux demandes, et confirmation que les formalités auprès de l’Instance nationale de protection des données personnelles sont accomplies.')}</section>
  <section aria-labelledby="contact"><h2 id="contact">Contact</h2><p>Pour une question sur cette politique ou sur vos données : <a href="mailto:kameltalbi.tn@gmail.com">kameltalbi.tn@gmail.com</a>, DECARBOTECH SARL, 3, rue Erroussafa, La Soukra 2036, Tunisie. Les <a href="/terms">conditions générales d’utilisation</a> décrivent le cadre du service.</p></section>`;
}

function termsDocument() {
  return `<p class="legal-kicker">Ciblix</p><h1>Conditions générales d’utilisation</h1><p class="legal-updated">Version du 30 octobre 2026. Les encadrés « À compléter » signalent un point qui n’est pas fixé dans l’application et qui reste à valider.</p>
  <nav class="legal-toc" aria-label="Sommaire"><ol>
    <li><a href="#editeur">Éditeur</a></li>
    <li><a href="#objet">Objet</a></li>
    <li><a href="#fonctionnalites">Fonctionnalités</a></li>
    <li><a href="#comptes">Comptes</a></li>
    <li><a href="#responsabilites">Responsabilités</a></li>
    <li><a href="#interdits">Usages interdits</a></li>
    <li><a href="#confidentialite">Confidentialité</a></li>
    <li><a href="#disponibilite">Disponibilité</a></li>
    <li><a href="#resiliation">Suspension et résiliation</a></li>
    <li><a href="#responsabilite-editeur">Limitation de responsabilité</a></li>
    <li><a href="#modifications">Modifications</a></li>
    <li><a href="#droit">Droit applicable</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol></nav>
  <section aria-labelledby="editeur"><h2 id="editeur">Éditeur</h2><p>Ciblix CRM est édité par DECARBOTECH SARL, société établie en Tunisie.</p>${publisherFacts()}</section>
  <section aria-labelledby="objet"><h2 id="objet">Objet</h2><p>Les présentes conditions encadrent l’accès au site <a href="https://ciblix.com">https://ciblix.com</a> et à l’espace de travail Ciblix CRM. Créer un compte ou utiliser l’espace vaut acceptation de la version publiée à cette adresse.</p><h3>Gratuité au lancement</h3><p>Au lancement, Ciblix CRM est proposé gratuitement. Cette gratuité initiale n’implique pas que toutes les fonctionnalités resteront gratuites de façon permanente.</p><p>Des abonnements payants pourront être proposés plus tard. Chaque offre payante sera présentée avec ses tarifs et ses conditions, de façon claire, avant toute souscription. Aucun paiement ne sera prélevé sans une souscription et un consentement explicites. Les conditions de résiliation d’une offre payante seront communiquées avant la souscription.</p><p>L’application ne contient pas de module de paiement. Aucun tarif, aucune date de mise en vente et aucune durée d’engagement ne sont affichés, parce qu’ils ne sont pas encore définis.</p></section>
  <section aria-labelledby="fonctionnalites"><h2 id="fonctionnalites">Fonctionnalités</h2><p>L’espace permet, pour une organisation :</p><ul>
    <li>de tenir des fiches contacts et entreprises, avec notes, historique et relances ;</li>
    <li>de travailler à plusieurs, avec un rôle d’administrateur et un rôle de membre ;</li>
    <li>d’inviter une personne par e-mail ;</li>
    <li>de se connecter par e-mail et mot de passe, ou, si cette option est activée sur le déploiement, avec Google pour l’identification seulement ;</li>
    <li>de connecter, de façon facultative, un ou plusieurs comptes Gmail pour envoyer un message et, après consentement, synchroniser l’historique lié aux contacts ;</li>
    <li>d’importer, de façon facultative et si la fonction est configurée, un document (image ou PDF) pour proposer des fiches après validation.</li>
  </ul><p>Le détail des autorisations Gmail et de l’importation de documents figure dans la <a href="/privacy">politique de confidentialité</a>. Le site public est proposé en français et en anglais. L’espace de travail est en français.</p><p>Ciblix ne garantit pas que Google accepte une autorisation, ni qu’un message soit délivré, ni que l’analyse d’un document soit exacte. Aucune fiche n’est créée depuis un document sans confirmation de l’utilisateur.</p></section>
  <section aria-labelledby="comptes"><h2 id="comptes">Comptes</h2><ul>
    <li>L’inscription demande un nom, une adresse e-mail et un mot de passe d’au moins 12 caractères. L’adresse doit être vérifiée avant l’accès.</li>
    <li>La personne qui crée l’espace en est l’administratrice. Elle peut inviter d’autres personnes. Une invitation est valable sept jours.</li>
    <li>L’administrateur peut modifier le rôle d’un membre ou désactiver son accès. L’organisation conserve au moins un administrateur actif.</li>
    <li>Chaque personne garde ses identifiants. Une session dure sept jours et se renouvelle au plus une fois par jour en cas d’utilisation. Changer le mot de passe clôt les autres sessions.</li>
    <li>La connexion Google, lorsqu’elle est proposée, sert à s’identifier. Elle ne remplace pas la connexion Gmail, qui reste une action séparée et facultative.</li>
  </ul></section>
  <section aria-labelledby="responsabilites"><h2 id="responsabilites">Responsabilités</h2><p>DECARBOTECH SARL fournit l’accès au service, l’authentification des comptes et le fonctionnement de l’espace. Elle n’est pas l’auteur des fiches que l’entreprise cliente y enregistre.</p><p>L’utilisateur veille à l’exactitude des informations de son compte. L’entreprise cliente est responsable des prospects, clients, notes, relances et messages qu’elle saisit, et du fait d’avoir le droit de les utiliser.</p><p>La personne qui envoie un e-mail depuis Ciblix choisit le destinataire, l’objet, le texte et les pièces jointes. Elle s’assure d’être autorisée à écrire à cette personne. Ciblix transmet ce message au compte Gmail qu’elle a connecté, puis l’enregistre dans l’historique de l’organisation après confirmation de Gmail.</p><p>L’administrateur veille aux accès qu’il ouvre. Un membre retiré ne doit plus être considéré comme autorisé à consulter l’espace.</p></section>
  <section aria-labelledby="interdits"><h2 id="interdits">Usages interdits</h2><p>Il est interdit d’utiliser Ciblix pour :</p><ul>
    <li>enfreindre la loi, porter atteinte aux droits d’une personne ou envoyer des messages non sollicités en masse ;</li>
    <li>accéder à l’espace d’une autre organisation, ou tenter de contourner l’authentification ;</li>
    <li>déposer un contenu malveillant, ou perturber le service ;</li>
    <li>demander à Ciblix le mot de passe d’une boîte Gmail, ou utiliser la connexion Gmail pour un autre usage que l’envoi demandé.</li>
  </ul></section>
  <section aria-labelledby="confidentialite"><h2 id="confidentialite">Confidentialité</h2><p>Le traitement des données est décrit dans la <a href="/privacy">politique de confidentialité</a>. Les membres d’une organisation ne doivent pas réutiliser hors de cet espace les informations auxquelles leur rôle leur donne accès, au-delà de ce que leur organisation autorise.</p></section>
  <section aria-labelledby="disponibilite"><h2 id="disponibilite">Disponibilité</h2><p>Le service est fourni en l’état de la version en ligne. L’application ne définit aucun taux de disponibilité, ni une fenêtre de maintenance.</p>${legalGap('Engagement de disponibilité, fenêtres de maintenance et support, s’il en existe. Aucun niveau de service chiffré n’est défini dans l’application.')}</section>
  <section aria-labelledby="resiliation"><h2 id="resiliation">Suspension et résiliation</h2><p>Un administrateur peut désactiver l’accès d’un membre. Cette désactivation retire ses sessions pour l’organisation. Elle ne supprime pas, à elle seule, les fiches déjà créées.</p><p>L’utilisateur peut cesser d’utiliser le service à tout moment. La suppression complète du compte n’est pas disponible dans l’interface. La déconnexion Gmail, elle, peut être faite dans les paramètres : elle retire le compte connecté et demande la révocation à Google, sans effacer l’historique déjà enregistré.</p><p>DECARBOTECH SARL peut refuser ou interrompre l’accès en cas d’usage interdit au sens de ces conditions. Aucun délai de préavis automatique n’est programmé dans l’application.</p><p>Lorsqu’une offre payante sera proposée, ses conditions de résiliation seront indiquées avant la souscription. Elles ne sont pas écrites ici, faute d’offre définie.</p>${legalGap('Préavis de fermeture d’un espace gratuit, et sort des données après la fin de l’accès (restitution, suppression, délai).')}</section>
  <section aria-labelledby="responsabilite-editeur"><h2 id="responsabilite-editeur">Limitation de responsabilité</h2><p>Ciblix est un outil de suivi. L’éditeur n’est pas responsable du contenu des fiches, ni des messages que l’utilisateur rédige et envoie. Il n’est pas responsable d’un refus, d’un retard ou d’une non-délivrance de la part de Google ou du destinataire.</p><p>L’éditeur n’est pas responsable des décisions prises à partir des informations saisies dans l’espace.</p>${legalGap('Plafond de responsabilité, exclusions éventuelles et loi qui les rendrait opposables. Aucun montant n’est défini.')}</section>
  <section aria-labelledby="modifications"><h2 id="modifications">Modifications</h2><p>La date en tête de page indique la version publiée. La version consultable à l’adresse de cette page remplace la précédente pour l’usage ultérieur du service.</p>${legalGap('Modalité d’information des utilisateurs en cas de changement (aucun e-mail de notification n’est prévu dans l’application).')}</section>
  <section aria-labelledby="droit"><h2 id="droit">Droit applicable</h2><p>L’éditeur est établi en Tunisie. Pour les données personnelles, le cadre pris en compte est la loi organique n° 2004-63. Cette mention ne constate pas une conformité vérifiée.</p>${legalGap('Droit régissant le contrat et juridiction compétente. Ils ne sont pas choisis dans l’application.')}</section>
  <section aria-labelledby="contact"><h2 id="contact">Contact</h2><p>Pour une question sur ces conditions : <a href="mailto:kameltalbi.tn@gmail.com">kameltalbi.tn@gmail.com</a>, DECARBOTECH SARL, 3, rue Erroussafa, La Soukra 2036, Tunisie.</p></section>`;
}
