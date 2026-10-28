const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const common = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').split('let reminders=')[0];
const { brand, icon } = vm.runInNewContext(common + '\n({brand,icon})', { document: { querySelector: () => ({}) } });
const { buildHomepageMarkup } = require('../public/homepage');
const markup = buildHomepageMarkup({ brandMarkup: brand, drawIcon: icon });
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#14532D">
<title>Ciblix — Le CRM collaboratif qui cultive vos relations</title>
<meta name="description" content="Centralisez vos contacts, partagez vos notes et organisez vos relances avec Ciblix, le CRM collaboratif pour votre équipe. Gmail et Android installable à venir.">
<meta property="og:type" content="website"><meta property="og:locale" content="fr_TN">
<meta property="og:title" content="Ciblix — Le CRM collaboratif qui cultive vos relations">
<meta property="og:description" content="Un espace partagé pour vos contacts, vos notes et vos prochaines actions. Découvrez les fonctions de Ciblix et créez votre compte.">
<link rel="preload" href="/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/homepage.css">
</head>
<body><div id="app">${markup}</div><div id="toast" role="status"></div>
<dialog id="detail" aria-labelledby="detail-title"><button class="dialog-close" aria-label="Fermer">×</button><div id="detail-content"></div></dialog>
<script defer src="/app.js"></script><script defer src="/homepage.js"></script><script defer src="/auth-ui.js"></script><script defer src="/live.js"></script>
</body></html>
`;
fs.writeFileSync(path.join(root, 'public/index.html'), html);
console.log('Homepage pré-rendue : 11 sections, aucun tarif.');
