/* Public landing page: commercial sections, one photograph, no product screenshots. */
const homeEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function buildHomepageMarkup({ drawIcon = typeof icon === 'function' ? icon : null, translate = typeof CiblixI18n !== 'undefined' ? key => CiblixI18n.t(key) : null, language = typeof CiblixI18n !== 'undefined' ? CiblixI18n.language : 'fr' } = {}) {
  if (!drawIcon || !translate) throw Error('La homepage nécessite les icônes et les traductions.');
  const text = key => homeEscape(translate(key));
  const logo = `<a class="brand" href="/" aria-label="${text('home')}">${drawIcon('leaf')}ciblix<span>.</span></a>`;
  const menuIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
  const benefits = [['people', 'benefit1Title', 'benefit1Text'], ['clock', 'benefit2Title', 'benefit2Text'], ['building', 'benefit3Title', 'benefit3Text']];
  const blocks = [
    ['contacts', 'people', 'block1Title', ['block1a', 'block1b', 'block1c', 'block1d']],
    ['relances', 'clock', 'block2Title', ['block2a', 'block2b', 'block2c', 'block2d']],
    ['collaboration', 'building', 'block3Title', ['block3a', 'block3b', 'block3c', 'block3d']]
  ];
  const steps = [['1', 'step1Title', 'step1Text'], ['2', 'step2Title', 'step2Text'], ['3', 'step3Title', 'step3Text']];
  const audiences = [['building', 'audience1Title', 'audience1Text'], ['people', 'audience2Title', 'audience2Text'], ['clock', 'audience3Title', 'audience3Text'], ['grid', 'audience4Title', 'audience4Text']];
  const reasons = [['check', 'why1Title', 'why1Text'], ['search', 'why2Title', 'why2Text'], ['building', 'why3Title', 'why3Text']];
  const questions = [['faq1q', 'faq1a'], ['faq2q', 'faq2a'], ['faq3q', 'faq3a']];
  const languageSelect = id => `<label class="home-language"><span class="sr-only">${text('language')}</span><select id="${id}" aria-label="${text('language')}"><option value="fr" ${language === 'fr' ? 'selected' : ''}>FR</option><option value="en" ${language === 'en' ? 'selected' : ''}>EN</option></select></label>`;
  const footerColumns = [
    ['homeFooterProduct', [['#fonctionnalites', 'homeNavFeatures'], ['#contacts', 'block1Title'], ['#relances', 'block2Title'], ['#collaboration', 'block3Title']]],
    ['homeFooterResources', [['#comment', 'homeNavHow'], ['#questions', 'faqTitle']]],
    ['homeFooterAccount', [['/inscription', 'signup'], ['/connexion', 'login']]]
  ];
  return `<div class="marketing-page public-page" data-home-version="7" data-lang="${homeEscape(language)}"><a class="home-skip" href="#contenu">${text('homeSkip')}</a><header class="marketing-header"><div class="home-header-inner">${logo}<button class="home-menu-toggle" id="home-menu-toggle" type="button" aria-expanded="false" aria-controls="home-menu" aria-label="${text('homeOpenMenu')}">${menuIcon}</button><div class="home-menu" id="home-menu"><nav class="home-nav" aria-label="${text('homeMainNav')}"><a href="#fonctionnalites">${text('homeNavFeatures')}</a><a href="#comment">${text('homeNavHow')}</a></nav><div class="public-auth-actions"><a class="text-link" href="/connexion">${text('login')}</a>${languageSelect('home-language')}<a class="button small" href="/inscription">${text('signup')}</a></div></div></div></header><main id="contenu">
  <section class="home-hero hero" aria-labelledby="home-title"><div class="home-container home-hero-grid"><div class="home-hero-copy"><h1 id="home-title">${text('homeLine1')}<br>${text('homeLine2')}<br>${text('homeLine3')}</h1><p>${text('homeSubtitle')}</p><div class="home-actions"><a class="button" href="/inscription">${text('createAccount')}</a><a class="text-link" href="#fonctionnalites">${text('homeDiscover')}</a></div></div><figure class="home-hero-image"><img src="/assets/presentation-tableau-de-bord.jpg" alt="${text('homeHeroAlt')}" width="1024" height="682" fetchpriority="high" loading="eager" decoding="async"></figure></div></section>
  <section class="home-band" aria-labelledby="benefits-title"><div class="home-container"><h2 id="benefits-title">${text('benefitsTitle')}</h2><ul class="home-benefit-row">${benefits.map(([name, title, description]) => `<li>${drawIcon(name)}<div><h3>${text(title)}</h3><p>${text(description)}</p></div></li>`).join('')}</ul></div></section>
  <section class="home-band home-band-features" id="fonctionnalites" aria-labelledby="features-title"><div class="home-container"><h2 id="features-title">${text('featuresTitle')}</h2><div class="home-blocks">${blocks.map(([id, name, title, items]) => `<article class="home-block" id="${id}">${drawIcon(name)}<h3>${text(title)}</h3><ul>${items.map(item => `<li>${drawIcon('check')}<span>${text(item)}</span></li>`).join('')}</ul></article>`).join('')}</div></div></section>
  <section class="home-band" id="comment" aria-labelledby="steps-title"><div class="home-container"><h2 id="steps-title">${text('stepsTitle')}</h2><ol class="home-steps">${steps.map(([number, title, description]) => `<li class="home-step"><span class="home-step-index">${number}</span><h3>${text(title)}</h3><p>${text(description)}</p></li>`).join('')}</ol></div></section>
  <section class="home-band home-band-muted" aria-labelledby="audience-title"><div class="home-container"><h2 id="audience-title">${text('audienceTitle')}</h2><div class="home-audience">${audiences.map(([name, title, description]) => `<article>${drawIcon(name)}<div><h3>${text(title)}</h3><p>${text(description)}</p></div></article>`).join('')}</div></div></section>
  <section class="home-band home-band-soft" aria-labelledby="why-title"><div class="home-container"><h2 id="why-title">${text('whyTitle')}</h2><ul class="home-why">${reasons.map(([name, title, description]) => `<li>${drawIcon(name)}<div><h3>${text(title)}</h3><p>${text(description)}</p></div></li>`).join('')}</ul></div></section>
  <section class="home-band" id="questions" aria-labelledby="faq-title"><div class="home-container home-faq-layout"><h2 id="faq-title">${text('faqTitle')}</h2><div class="home-faq">${questions.map(([question, answer]) => `<details class="home-faq-item"><summary>${text(question)}<span aria-hidden="true">+</span></summary><p>${text(answer)}</p></details>`).join('')}</div></div></section>
  <section class="home-cta" aria-labelledby="cta-title"><div class="home-container home-cta-inner"><div class="home-cta-copy"><h2 id="cta-title">${text('homeCta')}<br><span>${text('homeCtaNext')}</span></h2><p>${text('homeCtaBody')} <strong>${text('homeCtaEmphasis')}</strong>.</p></div><a class="button light" href="#fonctionnalites">${text('homeCtaButton')}</a></div></section>
  </main><footer class="home-footer"><div class="home-container home-footer-main"><div class="home-footer-brand">${logo}<p>${text('homeFooterText')}</p></div><div class="home-footer-links">${footerColumns.map(([label, links]) => `<nav aria-label="${text(label)}"><h2>${text(label)}</h2>${links.map(([href, key]) => `<a href="${href}">${text(key)}</a>`).join('')}</nav>`).join('')}</div></div><div class="home-container home-footer-bottom"><span>© ${new Date().getFullYear()} Ciblix</span>${languageSelect('home-language-footer')}</div></footer></div>`;
}

function renderPublicHomepage() {
  const restoreLanguage = ['home-language', 'home-language-footer'].includes(document.activeElement?.id) ? document.activeElement.id : '';
  const language = CiblixI18n.language;
  document.documentElement.lang = language;
  document.title = CiblixI18n.t('homeTitle');
  const current = document.querySelector('[data-home-version="7"]');
  if (!current || current.dataset.lang !== language) app.innerHTML = buildHomepageMarkup();
  window.ciblixHomepageEvents?.abort();
  const events = new AbortController();
  window.ciblixHomepageEvents = events;
  const page = document.querySelector('.marketing-page');
  const toggle = page.querySelector('#home-menu-toggle');
  const menu = page.querySelector('#home-menu');
  const closeMenu = () => { toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', CiblixI18n.t('homeOpenMenu')); menu.classList.remove('is-open'); };
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', CiblixI18n.t(open ? 'homeCloseMenu' : 'homeOpenMenu'));
    menu.classList.toggle('is-open', open);
  }, { signal: events.signal });
  page.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', closeMenu, { signal: events.signal }));
  document.addEventListener('keydown', event => { if (!page.isConnected) return events.abort(); if (event.key === 'Escape') closeMenu(); }, { signal: events.signal });
  document.addEventListener('click', event => { if (!page.isConnected) return events.abort(); if (!event.target.closest('.marketing-header')) closeMenu(); }, { signal: events.signal });
  page.querySelectorAll('#home-language, #home-language-footer').forEach(select => select.addEventListener('change', event => { CiblixI18n.setLanguage(event.target.value); renderPublicHomepage(); }, { signal: events.signal }));
  if (restoreLanguage) page.querySelector('#' + restoreLanguage).focus();
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildHomepageMarkup };
