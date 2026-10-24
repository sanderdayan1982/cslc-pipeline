import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, GEMINI_MODEL } from './config.js';

export const SETTINGS_PATH = join(DATA_DIR, 'settings.json');

export function readSettings() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(SETTINGS_PATH)) return { gemini: { key: '', model: GEMINI_MODEL }, vapid: null };
  try {
    return { gemini: { key: '', model: GEMINI_MODEL }, vapid: null, ...JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {
    return { gemini: { key: '', model: GEMINI_MODEL }, vapid: null };
  }
}

export function writeSettings(s) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
  try { chmodSync(SETTINGS_PATH, 0o600); } catch { /* windows */ }
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length < 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function publicGemini(settings, envKey = process.env.GEMINI_API_KEY) {
  const key = settings.gemini?.key || envKey || '';
  return {
    configured: !!key,
    masked: key ? maskKey(key) : '',
    origin: settings.gemini?.key ? 'app' : envKey ? 'env' : '',
    model: settings.gemini?.model || GEMINI_MODEL,
    key,
  };
}
