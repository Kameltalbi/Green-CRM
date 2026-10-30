const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const common = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').split('let reminders=')[0];
const { icon } = vm.runInNewContext(common + '\n({icon})', { document: { querySelector: () => ({}) } });
const i18nContext = { window: {}, URLSearchParams, location: { search: '' }, localStorage: { getItem() { return null; }, setItem() {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/i18n.js'), 'utf8'), i18nContext);
const translate = key => i18nContext.window.CiblixI18n.t(key);
const { buildHomepageMarkup } = require('../public/homepage');
const markup = buildHomepageMarkup({ drawIcon: icon, translate, language: 'fr' });
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#013BE5">
<title>${translate('homeTitle')}</title>
<meta name="description" content="${translate('homeSubtitle')}">
<meta property="og:type" content="website"><meta property="og:locale" content="fr_TN">
<meta property="og:title" content="${translate('homeTitle')}">
<meta property="og:description" content="${translate('homeSubtitle')}">
<link rel="icon" href="/assets/icon-ciblix.png" type="image/png">
<link rel="apple-touch-icon" href="/assets/icon-ciblix.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Ciblix">
<link rel="preload" href="/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/homepage.css">
</head>
<body><div id="app">${markup}</div><div id="toast" role="status"></div>
<dialog id="detail" aria-labelledby="detail-title"><button class="dialog-close" aria-label="Fermer">×</button><div id="detail-content"></div></dialog>
<script defer src="/app.js"></script><script defer src="/homepage.js"></script><script defer src="/i18n.js"></script><script defer src="/auth-ui.js"></script><script defer src="/legal.js"></script><script defer src="/live.js"></script><script defer src="/pwa.js"></script>
</body></html>
`;
fs.writeFileSync(path.join(root, 'public/index.html'), html);
console.log('Homepage pré-rendue : hero, trois fonctions, appel à l’action.');
