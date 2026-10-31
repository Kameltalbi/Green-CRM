#!/usr/bin/env node
/**
 * Configure DOCUMENT_AI_* dans .env (local uniquement).
 * La clé est saisie en terminal sans écho, hors historique shell et hors Git.
 * Ne modifie pas Gmail, Better Auth ni SMTP.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

const DEFAULTS = {
  DOCUMENT_AI_PROVIDER: 'gemini',
  DOCUMENT_AI_MODEL: 'gemini-2.5-flash',
  DOCUMENT_AI_MAX_BYTES: '8388608',
  DOCUMENT_AI_MAX_PAGES: '5',
  DOCUMENT_AI_ORG_DAILY_LIMIT: '20',
  DOCUMENT_AI_MONTHLY_BUDGET_USD: '10'
};

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const {stdin, stdout} = process;
    if (!stdin.isTTY || !stdout.isTTY) {
      reject(new Error('Lancez cette commande dans un terminal interactif (TTY).'));
      return;
    }
    stdout.write(prompt);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    let value = '';
    const finish = (err, result) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (err) reject(err);
      else resolve(result);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') return finish(null, value);
        if (ch === '\u0003') return finish(Object.assign(new Error('Annulé.'), {code: 'SIGINT'}));
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (ch === '\u0015') {
          value = '';
          continue;
        }
        if (ch < ' ') continue;
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function upsertEnv(content, key, value) {
  const line = key + '=' + value;
  const pattern = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=.*$', 'm');
  if (pattern.test(content)) return content.replace(pattern, line);
  const trimmed = content.replace(/\s*$/, '');
  return trimmed + (trimmed ? '\n' : '') + line + '\n';
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error('Fichier .env introuvable. Configurez d’abord PostgreSQL et .env.');
  }
  let env = fs.readFileSync(ENV_PATH, 'utf8');
  for (const [key, value] of Object.entries(DEFAULTS)) env = upsertEnv(env, key, value);

  const key = (await readSecret('Collez la clé DOCUMENT_AI_API_KEY (saisie masquée) : ')).trim();
  if (!key) throw new Error('Clé vide. Aucune modification de DOCUMENT_AI_API_KEY.');
  if (/\s/.test(key)) throw new Error('La clé ne doit pas contenir d’espaces.');
  if (key.length < 20) throw new Error('Clé trop courte. Vérifiez la valeur sans la coller dans le chat.');

  env = upsertEnv(env, 'DOCUMENT_AI_API_KEY', key);
  fs.writeFileSync(ENV_PATH, env.endsWith('\n') ? env : env + '\n', {mode: 0o600});
  try { fs.chmodSync(ENV_PATH, 0o600); } catch {}

  console.log('Configuration Document AI enregistrée dans .env (mode 600).');
  console.log('Fournisseur : gemini · modèle : gemini-2.5-flash · budget : 10 USD/mois · quota : 20 docs/org/jour · 8 Mo · 5 pages PDF.');
  console.log('La clé n’a pas été affichée, ni écrite dans l’historique shell, ni destinée à Git (.env est ignoré).');
  console.log('Redémarrez le serveur local pour prendre en compte la clé.');
}

main().catch((error) => {
  if (error.code === 'SIGINT') process.exitCode = 130;
  else {
    console.error(error.message || error);
    process.exitCode = 1;
  }
});
