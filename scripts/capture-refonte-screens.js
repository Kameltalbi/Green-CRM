#!/usr/bin/env node
/** Capture authenticated + public screens for the Pétrole & Sauge refonte (local only). */
require('dotenv').config({quiet: true});
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Pool} = require('pg');
const {fixtureSession} = require('../tests/session-fixture.cjs');

const OUT = path.join(process.cwd(), 'test-results', 'refonte-2026-11');
const PORT = 9277;
const BASE = 'http://127.0.0.1:3000';
fs.mkdirSync(OUT, {recursive: true});

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) throw new Error('DATABASE_URL / BETTER_AUTH_SECRET requis.');
  const admin = new Pool({connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL});
  const email = 'demo.refonte@ciblix.local';
  let orgId, userId;
  const existing = await admin.query('SELECT id FROM users WHERE email=$1', [email]);
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    const m = await admin.query('SELECT organization_id FROM memberships WHERE user_id=$1 AND active=true LIMIT 1', [userId]);
    if (m.rows[0]) orgId = m.rows[0].organization_id;
  }
  if (!orgId) {
    orgId = (await admin.query("INSERT INTO organizations(name) VALUES('Studio Sauge Démo') RETURNING id")).rows[0].id;
  }
  if (!userId) {
    userId = (await admin.query(
      "INSERT INTO users(email,name,email_verified) VALUES($1,'Amira Démo',true) RETURNING id",
      [email]
    )).rows[0].id;
  }
  if (!(await admin.query('SELECT 1 FROM memberships WHERE user_id=$1 AND organization_id=$2', [userId, orgId])).rows[0]) {
    await admin.query(
      "INSERT INTO memberships(organization_id,user_id,role,active,created_at) VALUES($1,$2,'admin',true,now())",
      [orgId, userId]
    );
  }
  const contactCount = (await admin.query('SELECT count(*)::int AS n FROM contacts WHERE organization_id=$1', [orgId])).rows[0].n;
  if (contactCount === 0) {
    const company = (await admin.query(
      "INSERT INTO companies(organization_id,name,sector,city,status,relation_type) VALUES($1,'AgroPlus','Agriculture','Tunis','en cours','prospect') RETURNING id",
      [orgId]
    )).rows[0].id;
    const contact = (await admin.query(
      "INSERT INTO contacts(organization_id,name,job_title,company_id,status,source) VALUES($1,'Leïla Mansour','Directrice commerciale',$2,'en cours','Prospection') RETURNING id",
      [orgId, company]
    )).rows[0].id;
    await admin.query(
      "INSERT INTO contact_emails(organization_id,contact_id,email) VALUES($1,$2,'leila@agroplus.example')",
      [orgId, contact]
    );
    await admin.query(
      "INSERT INTO followups(organization_id,contact_id,subject,due_at,status,owner_user_id) VALUES($1,$2,'Relancer la proposition',now()+interval '1 day','pending',$3)",
      [orgId, contact, userId]
    );
  }
  const {secret} = await fixtureSession(admin, userId, orgId, process.env.BETTER_AUTH_SECRET);

  const binary = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chrome = spawn(binary, [
    '--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ciblix-refonte-')),
    'about:blank'
  ], {stdio: 'ignore'});
  let targets;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch { await pause(100); }
  }
  if (!targets) throw new Error('Chrome indisponible');
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, {resolve, reject});
    ws.send(JSON.stringify({id, method, params}));
  });
  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const waitFor = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await ev(expression)) return;
      await pause(120);
    }
    throw new Error('Timeout: ' + expression);
  };
  const shot = async (name) => {
    await ev('document.fonts.ready');
    await pause(200);
    const png = await cdp('Page.captureScreenshot', {format: 'png', fromSurface: true});
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
    console.log('SHOT', file);
  };

  await cdp('Page.enable');
  await cdp('Network.enable');

  const views = [
    ['connexion-desktop', '/connexion', '#auth-main-form', 1440, false],
    ['connexion-mobile', '/connexion', '#auth-main-form', 390, true],
    ['dashboard-desktop', '/app', '.board-welcome, .dashboard-overview, .dashboard-analytics', 1440, false],
    ['dashboard-mobile', '/app', '.board-welcome, .dashboard-overview, .dashboard-analytics, h1', 390, true],
    ['contacts-desktop', '/app/contacts', '.directory-table, [data-directory-row], #result-count', 1440, false],
    ['contacts-mobile', '/app/contacts', '.directory-table, [data-directory-row], #result-count, h1', 390, true],
    ['relances-desktop', '/app/relances', '.agenda-layout, h1', 1440, false],
    ['relances-mobile', '/app/relances', '.agenda-layout, h1', 390, true],
    ['parametres-desktop', '/app', '.dashboard-top, .board-welcome', 1440, false],
  ];

  for (const [name, url, selector, width, mobile] of views) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width, height: mobile ? 844 : 1080, deviceScaleFactor: mobile ? 2 : 1, mobile
    });
    await cdp('Network.clearBrowserCookies');
    if (!url.startsWith('/connexion')) {
      await cdp('Network.setCookie', {
        name: 'ciblix.session_token', value: secret, url: BASE, httpOnly: true, sameSite: 'Lax'
      });
    }
    await cdp('Page.navigate', {url: BASE + url});
    const parts = selector.split(',').map((s) => s.trim());
    await waitFor(parts.map((s) => `!!document.querySelector(${JSON.stringify(s)})`).join('||'));
    if (name.startsWith('parametres')) {
      // Open settings/members if button exists
      await ev(`(document.querySelector('#members-button')||document.querySelector('[data-open-settings]')||document.querySelector('a[href*=\"param\"]'))?.click()`);
      await pause(500);
    }
    await shot(name);
  }

  // Visual checks: no decorative borders on key surfaces
  await cdp('Network.setCookie', {name: 'ciblix.session_token', value: secret, url: BASE, httpOnly: true, sameSite: 'Lax'});
  await cdp('Page.navigate', {url: BASE + '/app'});
  await waitFor('!!document.querySelector(".board-welcome, .dashboard-overview, h1")');
  const audit = await ev(`(() => {
    const pick = (sel) => document.querySelector(sel);
    const style = (el) => el ? getComputedStyle(el) : null;
    const board = pick('.board-metric') || pick('.panel') || pick('.dashboard-analytics .panel');
    const auth = null;
    const bs = style(board);
    const logo = pick('.brand-wordmark, .sidebar img, img[src*=\"logo\"]');
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      petroleum: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),
      sage: getComputedStyle(document.documentElement).getPropertyValue('--green').trim(),
      boardBorder: bs ? bs.borderTopWidth + ' ' + bs.borderTopStyle : null,
      logoNatural: logo ? {w: logo.naturalWidth, h: logo.naturalHeight, src: logo.getAttribute('src')} : null
    };
  })()`);
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(audit, null, 2));
  console.log('AUDIT', audit);

  ws.close();
  chrome.kill();
  await admin.end();
  console.log('OK captures dans', OUT);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
