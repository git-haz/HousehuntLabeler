import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STORE_DIR = path.join(os.homedir(), '.local-gmail-app');
const STORE_FILE = path.join(STORE_DIR, 'credentials.enc');
const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  return Buffer.from(hex, 'hex');
}

export function saveCredentials(data) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plain = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  fs.mkdirSync(STORE_DIR, { recursive: true });
  const payload = Buffer.concat([iv, tag, encrypted]);
  fs.writeFileSync(STORE_FILE, payload);
}

export function loadCredentials() {
  if (!fs.existsSync(STORE_FILE)) return null;
  const key = getKey();
  const raw = fs.readFileSync(STORE_FILE);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
