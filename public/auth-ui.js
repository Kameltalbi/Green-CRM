const authPages = new Set(['/inscription', '/connexion', '/mot-de-passe-oublie', '/reinitialiser-mot-de-passe', '/verification-email', '/invitation', '/bienvenue']);
const authT = (key, values) => CiblixI18n.t(key, values);
let authConfig = { googleEnabled: false, mailPreviewURL: null };
let authView = 0;
let completedReset = null;

function authMessage(data) {
  if (CiblixI18n.has(data?.code)) return authT(data.code);
  if (CiblixI18n.language === 'fr' && data?.message && /[àéèêôùîç’]/i.test(data.message)) return data.message;
  return authT('genericError');
}
async function authFetch(path, body) {
  const response = await fetch('/api/auth' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = Error(authMessage(data)); error.code = data.code; throw error; }
  return data;
}
async function accountContext() {
  const response = await fetch('/api/v1/account', { credentials: 'same-origin' });
  return response.ok ? response.json() : null;
}
async function accountWrite(path, body, account) {
  const response = await fetch('/api/v1' + path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': account.csrfToken }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Error(authMessage(data));
  return data;
}
function inviteToken() {
  const params = new URLSearchParams(location.search);
  return params.get('invitation') || (location.pathname === '/invitation' ? params.get('token') : null);
}
function authLink(path, token = inviteToken()) { return path + (token ? '?invitation=' + encodeURIComponent(token) : ''); }
function afterAuthURL(token = inviteToken()) { return token ? '/invitation?token=' + encodeURIComponent(token) : '/bienvenue'; }
function authAnchor(path, key, token = inviteToken()) { return `<a href="${authLink(path, token)}">${esc(authT(key))}</a>`; }
function authFeedback(message, success = false) { return `<p class="${success ? 'auth-success' : 'connection-error'}" role="${success ? 'status' : 'alert'}">${esc(message)}</p>`; }
function authLegalMarkup() {
  // No placeholder links or invented legal documents.
  return CiblixI18n.legalLinks.filter(link => ['privacy', 'terms', 'legal'].includes(link.key) && /^\/(?!\/|api\/)[^#]*$/.test(link.href))
    .map(link => `<a href="${esc(link.href)}">${esc(authT(link.key))}</a>`).join('');
}
function authLayout({ title, subtitle, body }) {
  document.documentElement.lang = CiblixI18n.language;
  document.title = title + ' — Ciblix';
  app.innerHTML = `<div class="auth-shell"><main class="auth-layout"><div class="auth-stack"><a class="brand" href="/" aria-label="${esc(authT('home'))}">${icon('leaf')}ciblix<span>.</span></a><section class="auth-card" aria-labelledby="auth-title"><h1 id="auth-title">${esc(title)}</h1><p class="auth-subtitle">${esc(subtitle)}</p>${body}</section></div></main><footer class="auth-footer"><span>© ${new Date().getFullYear()} Ciblix</span><nav aria-label="${esc(authT('legal'))}">${authLegalMarkup()}</nav><label class="auth-language"><span class="sr-only">${esc(authT('language'))}</span><select id="auth-language" aria-label="${esc(authT('language'))}"><option value="fr" ${CiblixI18n.language === 'fr' ? 'selected' : ''}>Français</option><option value="en" ${CiblixI18n.language === 'en' ? 'selected' : ''}>English</option></select></label></footer></div>`;
  bindPasswordToggles();
  document.querySelector('#auth-language').onchange = async event => {
    // Keep input values in memory only, including when toggling language mid-form.
    const path = location.pathname;
    const values = [...document.querySelectorAll('.auth-card input')].map(input => ({ name: input.name, value: input.value }));
    CiblixI18n.setLanguage(event.target.value);
    const params = new URLSearchParams(location.search); params.delete('lang');
    history.replaceState({}, '', location.pathname + (params.size ? '?' + params : ''));
    await renderAuthPage();
    if (location.pathname !== path) return;
    for (const item of values) { const input = [...document.querySelectorAll('.auth-card input')].find(input => input.name === item.name); if (input) input.value = item.value; }
    document.querySelector('#auth-language')?.focus();
  };
  renderMailDeliveryNotice();
}
function renderMailDeliveryNotice() {
  // Development-only tool, outside the main sign-in form and collapsed by default.
  if (!authConfig.mailPreviewURL || document.querySelector('.auth-local-mail') || ['/connexion', '/inscription'].includes(location.pathname)) return;
  try {
    const url = new URL(authConfig.mailPreviewURL);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return;
    document.querySelector('.auth-card').insertAdjacentHTML('beforeend', `<details class="auth-local-mail"><summary>${esc(authT('localMail'))}</summary><p>${esc(authT('localMailExplanation'))}</p><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(authT('localMailLink'))}</a></details>`);
  } catch {}
}
function passwordInput(label, name = 'password', confirm = false) {
  const login = location.pathname === '/connexion';
  return `<label class="auth-field" for="auth-${name}"><span>${esc(label)}</span><span class="password-field"><input id="auth-${name}" name="${name}" type="password" required minlength="12" maxlength="128" autocomplete="${confirm || !login ? 'new-password' : 'current-password'}" placeholder="${esc(authT(confirm ? 'confirmPlaceholder' : login ? 'passwordPlaceholder' : location.pathname === '/inscription' ? 'createPasswordPlaceholder' : 'newPassword'))}"><button type="button" data-show-password="${name}" aria-controls="auth-${name}" aria-label="${esc(authT('showPassword') + ': ' + label)}" aria-pressed="false">${esc(authT('show'))}</button></span></label>`;
}
function bindPasswordToggles() {
  document.querySelectorAll('[data-show-password]').forEach(button => {
    button.onclick = () => {
      const input = document.getElementById(button.getAttribute('aria-controls'));
      const show = input.type === 'password'; input.type = show ? 'text' : 'password';
      button.textContent = authT(show ? 'hide' : 'show');
      button.setAttribute('aria-pressed', String(show));
      const label = button.closest('label').querySelector('span').textContent;
      button.setAttribute('aria-label', authT(show ? 'hidePassword' : 'showPassword') + ': ' + label);
    };
  });
}
function bindAuthForm(id, handler) {
  bindForm(id, async (...args) => {
    const language = document.querySelector('#auth-language'); if (language) language.disabled = true;
    try { await handler(...args); }
    catch (error) {
      const feedback = args[1].querySelector('#auth-feedback');
      if (feedback) feedback.innerHTML = authFeedback(error.message);
      else throw error;
    } finally { if (language?.isConnected) language.disabled = false; }
  });
}
function googleButton() {
  return authConfig.googleEnabled ? `<button class="auth-google" type="button" id="auth-google">${esc(authT('google'))}</button><div class="auth-divider"><span>${esc(authT('or'))}</span></div>` : '';
}
function bindGoogle() {
  const button = document.querySelector('#auth-google'); if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const data = await authFetch('/sign-in/social', { provider: 'google', callbackURL: afterAuthURL(), newUserCallbackURL: afterAuthURL(), errorCallbackURL: authLink('/connexion') });
      if (!data.url) throw Error(authT('googleFailed'));
      location.assign(data.url);
    } catch (error) { document.querySelector('#auth-feedback').innerHTML = authFeedback(error.message); button.disabled = false; }
  };
}
async function authEntry(signup, view) {
  const params = new URLSearchParams(location.search), token = inviteToken(); let invitation = null;
  if (token) {
    const response = await fetch('/api/public/invitations/' + encodeURIComponent(token));
    if (view !== authView) return;
    if (!response.ok) { go('/invitation?token=' + encodeURIComponent(token)); return; }
    invitation = await response.json();
  }
  if (view !== authView) return;
  authLayout({ title: authT(signup ? 'signup' : 'login'), subtitle: invitation && signup ? authT('signupInvited', { company: invitation.organizationName }) : authT(signup ? 'signupIntro' : 'loginIntro'), body: `${invitation ? `<p class="auth-invitation-hint">${esc(authT('invitationTo', { company: invitation.organizationName }))}</p>` : ''}<div id="auth-provider">${googleButton()}</div><form id="auth-main-form" class="auth-form">${signup ? `<label class="auth-field"><span>${esc(authT('fullName'))}</span><input name="name" required minlength="2" maxlength="150" autocomplete="name" placeholder="${esc(authT('namePlaceholder'))}"></label>` : ''}<label class="auth-field"><span>${esc(authT(signup ? 'professionalEmail' : 'email'))}</span><input name="email" type="email" required maxlength="254" autocomplete="email" value="${esc(invitation?.email || '')}" placeholder="${esc(authT('emailPlaceholder'))}" autocapitalize="none" spellcheck="false"></label>${passwordInput(authT('password'))}${signup ? `${passwordInput(authT('confirmPassword'), 'confirmPassword', true)}<p class="auth-password-hint">${esc(authT('passwordHint'))}</p>` : `<input type="hidden" name="rememberMe" value="on"><div class="auth-login-options">${authAnchor('/mot-de-passe-oublie', 'forgot')}</div>`}<button class="button auth-submit" type="submit">${esc(authT(signup ? 'createAccount' : 'signIn'))}</button><div id="auth-feedback" aria-live="polite">${params.get('erreur') ? authFeedback(CiblixI18n.language === 'fr' ? params.get('erreur') : authT('genericError')) : params.has('error') ? authFeedback(authT('genericError')) : ''}</div></form><p class="auth-switch-copy">${esc(authT(signup ? 'hasAccount' : 'noAccount'))} ${authAnchor(signup ? '/connexion' : '/inscription', signup ? 'signIn' : 'signup')}</p>` });
  bindGoogle();
  bindAuthForm('auth-main-form', async data => {
    const callbackURL = afterAuthURL(token);
    if (signup) {
      if (data.password !== data.confirmPassword) throw Error(authT('mismatch'));
      await authFetch('/sign-up/email', { name: data.name.trim(), email: data.email.trim(), password: data.password, companyName: '', callbackURL });
      go('/verification-email?email=' + encodeURIComponent(data.email.trim()) + (token ? '&invitation=' + encodeURIComponent(token) : ''));
    } else {
      try {
        await authFetch('/sign-in/email', { email: data.email.trim(), password: data.password, rememberMe: data.rememberMe === 'on', callbackURL }); go(callbackURL);
      } catch (error) {
        if (error.code === 'EMAIL_NOT_VERIFIED') { go('/verification-email?email=' + encodeURIComponent(data.email.trim()) + (token ? '&invitation=' + encodeURIComponent(token) : '')); return; }
        throw error;
      }
    }
  });
}
function verificationScreen() {
  const params = new URLSearchParams(location.search), address = params.get('email') || '', token = inviteToken();
  authLayout({ title: authT('verifyTitle'), subtitle: authT('verifyIntro'), body: `<p class="auth-explanation">${esc(authT('verifyExplanation', { email: address || authT('yourEmail') }))}</p><form id="resend-verification" class="auth-form">${!address ? `<label class="auth-field"><span>${esc(authT('email'))}</span><input name="email" required type="email" autocomplete="email"></label>` : ''}<button class="button auth-submit" type="submit">${esc(authT('resend'))}</button><div id="auth-feedback" aria-live="polite"></div></form><p class="auth-switch-copy">${authAnchor('/connexion', 'backLogin', token)}</p><p class="auth-password-hint">${esc(authT('verificationHint'))}</p>` });
  bindAuthForm('resend-verification', async data => {
    await authFetch('/send-verification-email', { email: address || data.email, callbackURL: afterAuthURL(token) });
    document.querySelector('#auth-feedback').innerHTML = authFeedback(authT('verificationSent'), true);
  });
}
function forgotScreen() {
  authLayout({ title: authT('forgotTitle'), subtitle: authT('forgotIntro'), body: `<form id="forgot-form" class="auth-form"><label class="auth-field"><span>${esc(authT('email'))}</span><input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="${esc(authT('emailPlaceholder'))}" autocapitalize="none" spellcheck="false"></label><button class="button auth-submit" type="submit">${esc(authT('sendLink'))}</button><div id="auth-feedback" aria-live="polite"></div></form><p class="auth-switch-copy">${authAnchor('/connexion', 'backLogin')}</p>` });
  bindAuthForm('forgot-form', async data => {
    await authFetch('/request-password-reset', { email: data.email, redirectTo: '/reinitialiser-mot-de-passe' });
    document.querySelector('#auth-feedback').innerHTML = authFeedback(authT('resetSent'), true);
  });
}
function renderResetSuccess() {
  authLayout({ title: authT('resetSuccessTitle'), subtitle: authT('resetSuccessIntro'), body: `<a class="button auth-submit" href="/connexion">${esc(authT('signIn'))}</a>` });
}
function resetScreen() {
  const params = new URLSearchParams(location.search), token = params.get('token'), invalid = params.has('error') || !token;
  if (!invalid && completedReset === token) { renderResetSuccess(); return; }
  authLayout({ title: authT('resetTitle'), subtitle: authT('resetIntro'), body: invalid ? `${authFeedback(authT('invalidReset'))}<a class="button auth-submit" href="/mot-de-passe-oublie">${esc(authT('requestLink'))}</a>` : `<form id="reset-form" class="auth-form">${passwordInput(authT('newPassword'))}${passwordInput(authT('confirmPassword'), 'confirmPassword', true)}<p class="auth-password-hint">${esc(authT('resetHint'))}</p><button class="button auth-submit" type="submit">${esc(authT('savePassword'))}</button><div id="auth-feedback" aria-live="polite"></div></form>` });
  if (!invalid) bindAuthForm('reset-form', async data => {
    if (data.password !== data.confirmPassword) throw Error(authT('mismatch'));
    await authFetch('/reset-password', { newPassword: data.password, token });
    completedReset = token; renderResetSuccess();
  });
}
async function onboardingScreen(view) {
  if (new URLSearchParams(location.search).has('error')) {
    authLayout({ title: authT('expiredTitle'), subtitle: authT('expiredIntro'), body: `${authFeedback(authT('verifyAgain'))}<a class="button auth-submit" href="/verification-email">${esc(authT('resend'))}</a>` }); return;
  }
  const account = await accountContext(); if (view !== authView) return;
  if (!account) { go('/connexion'); return; }
  if (account.organizations.length) { await load(); go('/app'); return; }
  authLayout({ title: authT('welcome', { name: account.user.name.split(' ')[0] }), subtitle: authT('welcomeIntro'), body: `<form id="onboarding-form" class="auth-form"><label class="auth-field"><span>${esc(authT('company'))}</span><input name="companyName" required maxlength="150" autocomplete="organization" value="${esc(account.companyName)}" placeholder="${esc(authT('companyPlaceholder'))}"></label><p class="auth-password-hint">${esc(authT('workspaceHint'))}</p><button class="button auth-submit" type="submit">${esc(authT('createWorkspace'))}</button><div id="auth-feedback" aria-live="polite"></div></form><button class="auth-change-account" id="auth-change-account">${esc(authT('changeAccount'))}</button>` });
  bindAuthForm('onboarding-form', async data => { await accountWrite('/onboarding', { companyName: data.companyName.trim() }, account); await load(); go('/app'); });
  document.querySelector('#auth-change-account').onclick = safeAction(async () => { await authFetch('/sign-out', {}); session = null; go('/connexion'); });
  // Existing prefilled-company registrations still get automatic onboarding.
  if (account.companyName) {
    try { await accountWrite('/onboarding', { companyName: account.companyName }, account); await load(); go('/app'); }
    catch (error) { document.querySelector('#auth-feedback').innerHTML = authFeedback(error.message); }
  }
}
async function invitationScreen(view) {
  const token = new URLSearchParams(location.search).get('token'); let invitation;
  try {
    const response = await fetch('/api/public/invitations/' + encodeURIComponent(token || '')); invitation = await response.json();
    if (!response.ok) throw Error(authT('invalidInvitation'));
  } catch (error) {
    if (view !== authView) return;
    authLayout({ title: authT('invitationUnavailable'), subtitle: authT('invitationUnavailableIntro'), body: `${authFeedback(error.message)}<p class="auth-explanation">${esc(authT('askInvitation'))}</p><a class="button auth-submit" href="/connexion">${esc(authT('signIn'))}</a>` }); return;
  }
  const account = await accountContext(); if (view !== authView) return;
  const wrong = account && account.user.email.toLowerCase() !== invitation.email.toLowerCase();
  const date = new Intl.DateTimeFormat(CiblixI18n.language === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(invitation.expiresAt));
  authLayout({ title: authT('invitationTitle'), subtitle: authT('invitationIntro', { company: invitation.organizationName }), body: `<div class="auth-invite-summary"><div><strong>${esc(invitation.organizationName)}</strong><span>${esc(authT('invitationFor', { email: invitation.email }))}</span></div></div><p class="auth-explanation">${esc(authT('invitationExplanation'))}</p>${wrong ? authFeedback(authT('wrongAccount', { email: account.user.email })) : account ? `<form id="accept-invitation-form" class="auth-form"><button class="button auth-submit" type="submit">${esc(authT('acceptInvitation'))}</button><div id="auth-feedback" aria-live="polite"></div></form>` : `<a class="button auth-submit" href="${authLink('/inscription', token)}">${esc(authT('signupJoin'))}</a><p class="auth-switch-copy">${esc(authT('hasAccount'))} ${authAnchor('/connexion', 'signIn', token)}</p>`}${account ? `<button class="auth-change-account" id="auth-change-account">${esc(authT('changeAccount'))}</button>` : ''}<p class="auth-password-hint">${esc(authT('invitationUntil', { date }))}</p>` });
  if (account && !wrong) bindAuthForm('accept-invitation-form', async () => { await accountWrite('/invitations/accept', { token }, account); await load(); go('/app'); });
  document.querySelector('#auth-change-account')?.addEventListener('click', safeAction(async () => { await authFetch('/sign-out', {}); session = null; go('/invitation?token=' + encodeURIComponent(token)); }));
}
async function renderAuthPage() {
  const view = ++authView, path = location.pathname;
  app.innerHTML = `<main class="board-empty" aria-live="polite"><p>${esc(authT('loading'))}</p></main>`;
  try {
    // The primary form never waits for optional provider configuration.
    authConfig = { googleEnabled: false, mailPreviewURL: null };
    const configRequest = fetch('/api/public/auth-config').then(response => response.ok ? response.json() : {}).catch(() => ({}));
    if (path === '/connexion' || path === '/inscription') await authEntry(path === '/inscription', view);
    else if (path === '/verification-email') verificationScreen();
    else if (path === '/mot-de-passe-oublie') forgotScreen();
    else if (path === '/reinitialiser-mot-de-passe') resetScreen();
    else if (path === '/bienvenue') await onboardingScreen(view);
    else if (path === '/invitation') await invitationScreen(view);
    const config = await configRequest;
    if (view !== authView || path !== location.pathname) return;
    authConfig = config;
    const providers = document.querySelector('#auth-provider');
    if (providers) { providers.innerHTML = googleButton(); bindGoogle(); }
    renderMailDeliveryNotice();
  } catch (error) {
    if (view === authView && path === location.pathname) authLayout({ title: authT('unavailableTitle'), subtitle: authT('unavailableIntro'), body: `${authFeedback(error.message)}<a class="button auth-submit" href="/connexion">${esc(authT('backLogin'))}</a>` });
  }
}
