const crypto = require('node:crypto');

function key(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Secret de chiffrement insuffisant.');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('ciblix-gmail'), Buffer.from('oauth-tokens-v1'), 32));
}

function encrypt(secret, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from('gmail-token'));
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

function decrypt(secret, payload) {
  const buf = Buffer.from(payload, 'base64url');
  if (buf.length < 29) throw new Error('Jeton illisible.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(secret), buf.subarray(0, 12));
  decipher.setAAD(Buffer.from('gmail-token'));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = {encrypt, decrypt};
