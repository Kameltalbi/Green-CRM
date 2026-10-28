/* Homepage publique : présentation des capacités existantes, sans dépendance au back-end. */
function buildHomepageMarkup({ brandMarkup = brand, drawIcon = icon } = {}) {
  const icon = drawIcon;
  const screenshot = (file, alt, caption, { eager = false, mobile = false } = {}) => `<figure class="home-capture${mobile ? ' home-capture-mobile' : ''}"><a href="/assets/product/${file}.png" target="_blank" rel="noopener" aria-label="Agrandir : ${alt}"><img src="/assets/product/${file}.png" alt="${alt}" width="${mobile ? 390 : 1440}" height="1080" ${eager ? 'fetchpriority="high" loading="eager"' : 'loading="lazy"'} decoding="async"></a><figcaption>${caption} <span>Captures réelles · données de démonstration</span></figcaption></figure>`;
  const check = text => `<li>${icon('check')}<span>${text}</span></li>`;
  const faq = [
    ['À quoi sert Ciblix au quotidien ?', 'Ciblix réunit vos entreprises, vos contacts, vos notes et vos relances dans un espace partagé. Vous retrouvez le contexte d’une relation et savez quelle prochaine action préparer.'],
    ['Comment créer mon espace entreprise ?', 'Créez votre compte avec une adresse e-mail et un mot de passe, puis vérifiez votre adresse. Le nom de votre entreprise permet de créer votre espace, dont vous devenez administrateur. L’inscription Google est également prévue dans le parcours ; sa disponibilité dépend de sa configuration.'],
    ['Mes collaborateurs voient-ils les mêmes informations ?', 'Oui. Les membres autorisés d’une même organisation partagent ses contacts, entreprises, notes et relances. Un responsable peut être attribué à une fiche. Les administrateurs gèrent les invitations, les accès et les suppressions définitives.'],
    ['Puis-je déjà connecter mon Gmail ?', 'Pas encore. L’intégration Gmail est à venir. Les notes et l’historique des actions Ciblix sont disponibles aujourd’hui. La future connexion Gmail demandera une autorisation distincte de la connexion à votre compte Ciblix.'],
    ['Les relances envoient-elles des e-mails automatiquement ?', 'Non. Vous planifiez, attribuez, reportez ou terminez vos relances. Vous pouvez préparer et conserver un texte de brouillon dans Ciblix. Aucun message n’est envoyé automatiquement et la création de brouillons dans Gmail reste à venir.'],
    ['Puis-je utiliser Ciblix sur mon téléphone Android ?', 'Oui, l’interface web s’adapte à votre téléphone : répertoire compact, fiches détaillées et relances. Une application Android installable est à venir.'],
    ['Les données sont-elles conservées après déconnexion ?', 'Oui. Les fiches, notes, relances et pièces de carte de visite sont enregistrées dans la base de données. Elles restent disponibles après rechargement et reconnexion. Les données d’une organisation sont isolées de celles des autres organisations.'],
    ['Ciblix convient-il à mon secteur d’activité ?', 'Ciblix se concentre sur le suivi des relations professionnelles, sans pipeline complexe, devis ni facturation. Une équipe industrielle, de services, de conseil ou une association peut organiser ses interlocuteurs, son contexte et ses prochaines actions.']
  ];
  return `<div class="marketing-page public-page" data-home-version="2">
    <a class="home-skip" href="#contenu">Aller au contenu</a>
    <header class="marketing-header"><div class="home-header-inner">
      ${brandMarkup}
      <button class="home-menu-toggle icon-button" id="home-menu-toggle" aria-expanded="false" aria-controls="home-menu" aria-label="Ouvrir le menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      <div class="home-menu" id="home-menu"><nav class="home-nav" aria-label="Navigation principale">
        <details class="home-dropdown"><summary>Fonctionnalités <span aria-hidden="true">⌄</span></summary><div class="home-dropdown-panel"><a href="#contacts">${icon('people')} Contacts & entreprises</a><a href="#relances">${icon('clock')} Relances & échéances</a><a href="#equipe">${icon('building')} Collaboration</a><a href="#produit">${icon('grid')} Vue du produit</a></div></details>
        <details class="home-dropdown"><summary>Solutions <span aria-hidden="true">⌄</span></summary><div class="home-dropdown-panel"><a href="#industrie">Industrie</a><a href="#services">Services</a><a href="#conseil">Conseil</a><a href="#associations">Associations</a><a href="#mobilite">En mobilité</a></div></details>
        <a href="#integrations">Intégrations</a><a href="#faq">FAQ</a>
      </nav><div class="public-auth-actions"><a class="text-link" href="/connexion">Se connecter</a><a class="button small" href="/inscription">Essayer gratuitement ${icon('arrow')}</a></div></div>
    </div></header>
    <main id="contenu">
      <section class="home-hero hero" aria-labelledby="home-title"><div class="home-container home-hero-grid"><div class="home-hero-copy">
        <span class="eyebrow">LE CRM QUI CULTIVE VOS RELATIONS</span><h1 id="home-title">Moins de dispersion.<br>Plus de <em>relations.</em></h1>
        <p>Vos contacts, vos notes et vos relances, enfin réunis. Un espace simple et partagé pour avancer ensemble, sans rien laisser de côté.</p>
        <div class="home-actions hero-actions"><a class="button" href="/inscription">Créer mon compte ${icon('arrow')}</a><a class="button board-secondary" href="#produit">Voir le produit</a></div>
        <ul class="home-assurances">${check('Vos contacts et vos notes au même endroit')}${check('Un suivi partagé avec votre équipe')}${check('Un espace privé pour votre entreprise')}</ul>
      </div><div class="home-product-stage">
        ${screenshot('dashboard', 'Tableau de bord Ciblix avec indicateurs, graphiques et relances', 'Une vue claire de votre activité.', { eager: true })}
        <div class="home-phone-inset" aria-hidden="true"><img src="/assets/product/mobile.png" alt="" width="390" height="1080" loading="lazy" decoding="async"></div>
      </div></div></section>
      <section class="home-benefits" id="benefices" aria-label="Les trois bénéfices de Ciblix"><div class="home-container home-benefits-grid">
        <article>${icon('people')}<div><h2>Le bon contexte.</h2><p>Les personnes, les entreprises et les notes utiles à portée de main.</p></div></article>
        <article>${icon('building')}<div><h2>La même information.</h2><p>Un suivi partagé pour savoir qui prend la suite dans votre équipe.</p></div></article>
        <article>${icon('clock')}<div><h2>La prochaine attention.</h2><p>Des actions attribuées et des échéances claires pour garder le lien.</p></div></article>
      </div></section>
      <section class="home-section" id="produit" aria-labelledby="product-title"><div class="home-container">
        <div class="home-section-heading"><span class="eyebrow">UNE VUE D’ENSEMBLE CLAIRE</span><h2 id="product-title">Un CRM simple, du premier contact<br>à la prochaine relance.</h2><p>Retrouvez votre répertoire, vos notes et les actions de votre équipe dans une interface lisible. L’essentiel est organisé, le contexte reste accessible.</p></div>
        <div class="home-overview">${screenshot('contacts', 'Répertoire Ciblix avec onglets Entreprises et Contacts, recherche, filtres et pagination', 'Votre réseau, organisé et partagé.')}</div>
        <div class="home-product-steps" aria-label="Un quotidien plus simple"><div><span>01</span><p><strong>Centralisez</strong> les coordonnées et les informations utiles.</p></div><div><span>02</span><p><strong>Partagez</strong> le contexte avec les bons collaborateurs.</p></div><div><span>03</span><p><strong>Préparez</strong> la prochaine action sans perdre le fil.</p></div></div>
      </div></section>
      <section class="home-section home-section-soft" id="contacts" aria-labelledby="contacts-title"><div class="home-container home-split">
        <div class="home-feature-copy"><span class="eyebrow">CONTACTS & ENTREPRISES</span><h2 id="contacts-title">Chaque relation mérite<br>une fiche qui a du sens.</h2><p>Un nom, une entreprise, des coordonnées, un historique. Retrouvez ce qu’il faut savoir avant de reprendre contact, sans parcourir plusieurs fichiers.</p><ul class="home-check-list">${check('Deux vues : Entreprises et Contacts, avec recherche et filtres.')}${check('Des fiches détaillées, des notes partagées et un responsable identifié.')}${check('Une prochaine relance visible dans le contexte de la relation.')}</ul><a href="/inscription" class="text-link">Organiser mon réseau ${icon('arrow')}</a></div>
        ${screenshot('contact-detail', 'Fiche contact Ciblix avec coordonnées, notes partagées, historique et prochaine relance', 'Tout le contexte de votre interlocuteur.')}
      </div></section>
      <section class="home-section" id="integrations" aria-labelledby="gmail-title"><div class="home-container home-split home-split-reverse">
        <div class="home-feature-copy"><span class="home-status">${icon('mail')} INTÉGRATION GMAIL · À VENIR</span><h2 id="gmail-title">Vos échanges, bientôt<br>dans le même fil.</h2><p>La connexion Gmail viendra enrichir le contexte de vos contacts avec les échanges reconnus par le CRM. Elle demandera une autorisation distincte, propre à chaque collaborateur.</p><div class="home-status-note"><strong>Disponible aujourd’hui</strong><p>Vos notes et l’historique des actions Ciblix sont déjà partagés dans la fiche entreprise.</p></div><ul class="home-check-list">${check('À venir : connexion individuelle des comptes Gmail.')}${check('À venir : échanges rattachés aux contacts enregistrés.')}${check('À venir : réponses reçues et brouillons dans Gmail.')}</ul><a class="text-link" href="#faq">Comprendre ce qui est disponible ${icon('arrow')}</a></div>
        ${screenshot('entreprise', 'Historique partagé actuellement disponible dans une fiche entreprise Ciblix, sans connexion Gmail', 'L’historique actuel de Ciblix. Les échanges Gmail sont à venir.')}
      </div></section>
      <section class="home-section home-section-soft" id="relances" aria-labelledby="followup-title"><div class="home-container home-split">
        <div class="home-feature-copy"><span class="eyebrow">RELANCES, ACTIONS & ÉCHÉANCES</span><h2 id="followup-title">Une prochaine étape claire.<br>Un esprit plus libre.</h2><p>Préparez vos actions de suivi, attribuez-les à un collaborateur et retrouvez les échéances du jour. Chacun sait quelle relation reprendre et quand.</p><ul class="home-check-list">${check('Des vues simples : en retard, aujourd’hui et à venir.')}${check('Planifier, reporter, terminer ou annuler une relance.')}${check('Préparer un texte de brouillon, sans envoi automatique.')}</ul><p class="home-factual-note">Les actions sont suivies sous forme de relances attribuées. La création de brouillons dans Gmail est à venir.</p><a class="text-link" href="/inscription">Clarifier mes prochaines actions ${icon('arrow')}</a></div>
        ${screenshot('relances', 'Agenda des relances Ciblix regroupées par échéance et attribuées aux collaborateurs', 'Le bon suivi, au bon moment.')}
      </div></section>
      <section class="home-section" id="equipe" aria-labelledby="team-title"><div class="home-container home-split home-split-reverse">
        <div class="home-feature-copy"><span class="eyebrow">UN ESPACE COMMUN, VOTRE UNIVERS</span><h2 id="team-title">Avancer ensemble,<br>avec le même contexte.</h2><p>Chaque entreprise cliente dispose de son espace privé. À l’intérieur, vos collaborateurs autorisés partagent les fiches, les notes et les relances de l’équipe.</p><ul class="home-check-list">${check('Invitations par e-mail et rôles administrateur ou collaborateur.')}${check('Un responsable par fiche, sans cloisonner le travail de l’équipe.')}${check('Un historique partagé pour comprendre ce qui a déjà été fait.')}</ul><a class="text-link" href="/inscription">Créer l’espace de mon équipe ${icon('arrow')}</a></div>
        ${screenshot('equipe', 'Gestion des membres et invitations Ciblix dans un espace entreprise', 'Les bonnes personnes dans le bon espace.')}
      </div></section>
      <section class="home-section home-use-cases" id="solutions" aria-labelledby="solutions-title"><div class="home-container"><div class="home-section-heading home-heading-left"><span class="eyebrow">DES RELATIONS HUMAINES, DANS TOUS LES SECTEURS</span><h2 id="solutions-title">Votre activité change.<br>L’importance du lien reste.</h2><p>Ciblix se concentre sur vos interlocuteurs et votre suivi, avec un cadre commun que votre équipe peut s’approprier.</p></div><div class="home-sector-grid">${[
        ['industrie','settings','Industrie','Retrouvez les contacts de vos partenaires et les prochaines actions à mener.'],
        ['services','building','Services','Partagez le contexte de vos échanges et gardez vos échéances visibles.'],
        ['conseil','people','Conseil','Conservez les notes de vos rencontres et préparez vos prochains échanges.'],
        ['associations','leaf','Associations','Organisez vos interlocuteurs, vos partenaires et les actions de votre équipe.']
      ].map(([id,i,title,description])=>`<article id="${id}">${icon(i)}<h3>${title}</h3><p>${description}</p><a href="/inscription" class="text-link">Découvrir Ciblix ${icon('arrow')}</a></article>`).join('')}</div></div></section>
      <section class="home-section" id="mobilite" aria-labelledby="mobile-title"><div class="home-container home-mobile-grid">
        <div class="home-mobile-visual">${screenshot('mobile', 'Version mobile réelle du répertoire Ciblix dans le navigateur', 'Votre répertoire sur téléphone.', { mobile: true })}</div>
        <div class="home-feature-copy"><span class="eyebrow">VOTRE CRM, PARTOUT AVEC VOUS</span><h2 id="mobile-title">Au bureau.<br>Et partout après.</h2><p>Retrouvez vos contacts et vos relances depuis le navigateur de votre ordinateur, tablette ou téléphone Android. Une interface qui suit votre quotidien.</p><ul class="home-check-list">${check('Un répertoire mobile sous forme de liste compacte.')}${check('Les coordonnées, les notes et le suivi accessibles dans les fiches.')}${check('Les mêmes données enregistrées dans votre espace.')}</ul><div class="home-status-note"><strong>${icon('phone')} Application Android · À venir</strong><p>Une application installable est prévue. L’interface web responsive est disponible aujourd’hui.</p></div></div>
      </div></section>
      <section class="home-section home-section-soft" id="faq" aria-labelledby="faq-title"><div class="home-container"><div class="home-section-heading home-faq-heading"><span class="eyebrow">QUESTIONS FRÉQUENTES</span><h2 id="faq-title">Les réponses pour<br>commencer sereinement.</h2><p>Ce que Ciblix permet déjà, et ce qui viendra ensuite.</p></div><div class="home-faq-grid">${faq.map(([q,a])=>`<details class="home-faq-item"><summary>${q}<span aria-hidden="true">＋</span></summary><p>${a}</p></details>`).join('')}</div></div></section>
      <section class="home-final-cta closing" id="commencer" aria-labelledby="start-title"><div class="home-container"><span class="eyebrow">FAITES DE LA PLACE À VOS RELATIONS</span><h2 id="start-title">Votre prochain échange<br>commence ici.</h2><p>Créez votre espace et donnez à votre équipe un point de départ commun.</p><a class="button light" href="/inscription">Créer mon compte ${icon('arrow')}</a><a href="/connexion" class="home-final-login">Vous avez déjà un compte ? Se connecter</a></div></section>
    </main>
    <footer class="home-footer"><div class="home-container"><div class="home-footer-intro">${brandMarkup}<p>Le CRM collaboratif, simplement.<br>Vos relations, avec toute votre équipe.</p></div><div class="home-footer-columns">
      <nav aria-label="Produit"><h2>Produit</h2><a href="#produit">Vue du produit</a><a href="#contacts">Entreprises & contacts</a><a href="#relances">Relances</a><a href="#equipe">Pour votre équipe</a><a href="#integrations">Gmail · À venir</a><a href="#mobilite">Mobile & Android</a></nav>
      <nav aria-label="Ressources"><h2>Ressources</h2><a href="#benefices">Les bénéfices</a><a href="#solutions">Cas d’usage</a><a href="#faq">Questions fréquentes</a><a href="#produit">Captures du produit</a></nav>
      <nav aria-label="Entreprise"><h2>Entreprise</h2><a href="#a-propos" data-home-info="a-propos">À propos de Ciblix</a><a href="#contact" data-home-info="contact">Contact · À publier</a><a href="/inscription">Créer un compte</a><a href="/connexion">Se connecter</a></nav>
      <nav aria-label="Informations légales"><h2>Informations légales</h2><a href="#conditions-generales" data-home-info="conditions-generales">Conditions générales · À publier</a><a href="#confidentialite" data-home-info="confidentialite">Confidentialité · À publier</a><a href="#mentions-legales" data-home-info="mentions-legales">Mentions légales · À publier</a><p>Ces informations seront publiées après validation de leurs contenus.</p></nav>
    </div><div class="home-footer-bottom"><span>© 2026 Ciblix</span><span>Interface en français</span><a href="#contenu">Retour en haut ↑</a></div></div></footer>
  </div>`;
}
function renderPublicHomepage() {
  document.title = 'Ciblix — Le CRM collaboratif qui cultive vos relations';
  if (!document.querySelector('[data-home-version="2"]')) app.innerHTML = buildHomepageMarkup();
  window.ciblixHomepageEvents?.abort();
  const events = new AbortController();
  window.ciblixHomepageEvents = events;
  const page = document.querySelector('.marketing-page');
  const toggle = page.querySelector('#home-menu-toggle');
  const menu = page.querySelector('#home-menu');
  const closeMenu = () => { toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', 'Ouvrir le menu'); menu.classList.remove('is-open'); };
  const closeDropdowns = except => page.querySelectorAll('.home-dropdown[open]').forEach(d => { if (d !== except) d.open = false; });
  toggle.addEventListener('click', () => { const open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu'); menu.classList.toggle('is-open', open); }, { signal: events.signal });
  page.querySelectorAll('.home-dropdown').forEach(d => d.addEventListener('toggle', () => { if (d.open) closeDropdowns(d); }, { signal: events.signal }));
  page.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', () => { closeMenu(); closeDropdowns(); }, { signal: events.signal }));
  document.addEventListener('keydown', e => { if (!page.isConnected) return events.abort(); if (e.key === 'Escape') { const wasOpen = toggle.getAttribute('aria-expanded') === 'true'; const dropdown = page.querySelector('.home-dropdown[open]'); closeMenu(); closeDropdowns(); if (wasOpen) toggle.focus(); else dropdown?.querySelector('summary').focus(); } }, { signal: events.signal });
  document.addEventListener('click', e => { if (!page.isConnected) return events.abort(); if (!e.target.closest('.home-dropdown')) closeDropdowns(); if (!e.target.closest('.marketing-header')) closeMenu(); }, { signal: events.signal });
  const information = {
    'a-propos': ['À propos de Ciblix', '<p>Ciblix est un CRM collaboratif destiné aux entreprises qui souhaitent centraliser leurs contacts, leurs notes et leurs actions de suivi.</p><p>Le produit est en développement. Les fonctions Gmail et l’application Android installable sont présentées comme « À venir » tant qu’elles ne sont pas disponibles.</p>'],
    'contact': ['Contact — informations à publier', '<p>Aucune adresse de contact publique n’a encore été fournie pour cette page.</p><p>Les coordonnées de l’équipe Ciblix seront publiées ici après validation. Cette page ne permet pas encore d’envoyer un message.</p>'],
    'conditions-generales': ['Conditions générales — à publier', '<p>Les conditions générales validées n’ont pas encore été fournies pour publication.</p><p>Le document sera accessible à cet emplacement après validation.</p>'],
    'confidentialite': ['Confidentialité — document à publier', '<p>La politique de confidentialité officielle n’a pas encore été fournie pour publication.</p><p>Les informations concernant le responsable du traitement, les durées de conservation et les modalités d’exercice des droits doivent être confirmées avant publication du document.</p>'],
    'mentions-legales': ['Mentions légales — à publier', '<p>Les informations légales de l’éditeur et de l’hébergement n’ont pas encore été fournies pour publication.</p><p>Les coordonnées légales seront accessibles ici après validation.</p>']
  };
  const openInfo = key => { const value = information[key]; if (!value) return; const dialog = document.querySelector('#detail'); dialog.classList.remove('contact-drawer'); document.querySelector('#detail-content').innerHTML = `<span class="eyebrow">CIBLIX · INFORMATIONS PUBLIQUES</span><h2 id="detail-title">${value[0]}</h2>${value[1]}`; dialog.showModal(); };
  page.querySelectorAll('[data-home-info]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); history.replaceState({}, '', a.getAttribute('href')); openInfo(a.dataset.homeInfo); }, { signal: events.signal }));
  window.addEventListener('hashchange', () => { if (!page.isConnected) return events.abort(); openInfo(location.hash.slice(1)); }, { signal: events.signal });
  document.querySelector('#detail').addEventListener('close', () => { if (information[location.hash.slice(1)]) history.replaceState({}, '', '/'); }, { signal: events.signal });
  openInfo(location.hash.slice(1));
}
if (typeof module !== 'undefined' && module.exports) module.exports = { buildHomepageMarkup };
