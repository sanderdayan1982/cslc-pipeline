import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const KEYS = ['GEMINI_API_KEY'];
let file = null;
let saved = {};
let fromEnvFile = null;

// Keys saved in the app take precedence over .env, so the user never has to edit files.
export function loadSettings(path) {
  file = path;
  fromEnvFile ??= Object.fromEntries(KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  try {
    if (existsSync(path)) saved = JSON.parse(readFileSync(path, 'utf8')) || {};
  } catch (err) {
    console.warn(`[ajustes] ${path} ilegible: ${err.message}`);
    saved = {};
  }
  apply();
}

function apply() {
  for (const k of KEYS) {
    const v = saved[k] ?? fromEnvFile[k];
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
}

export function setSetting(key, value) {
  if (!KEYS.includes(key)) throw new Error(`ajuste desconocido: ${key}`);
  if (value) saved[key] = value;
  else delete saved[key];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
  apply();
}

export const mask = (v) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : null);

export function publicSettings() {
  const key = process.env.GEMINI_API_KEY;
  return {
    gemini: {
      configured: !!key,
      masked: mask(key),
      origin: saved.GEMINI_API_KEY ? 'app' : key ? 'env' : null,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
  };
}
